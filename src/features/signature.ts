/** Signature help from the token stream plus binder/stdlib signatures (directive §7.5). */
import type { ParameterInformation, SignatureHelp, SignatureInformation } from 'vscode-languageserver/node.js';
import { BANG_SIGNATURES, PURE_SIGNATURES, type FnDecl, type Token } from '../analysis/core-adapter.js';
import { visibleBindings } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { collectNodes } from '../analysis/walk.js';

const PARAM_NAMES: Record<string, string[]> = {
  'fs.readFile': ['path'],
  'fs.writeFile': ['path', 'content'],
  curl: ['url'],
  print: ['value'],
  eprint: ['value'],
  'json.parse': ['text'],
};

interface Callee {
  name: string;
  bang: boolean;
}

interface ResolvedSignature {
  label: string;
  parameters: ParameterInformation[];
}

function textOf(source: string, token: Token): string {
  return source.slice(token.span[0], token.span[1]);
}

function innermostOpenParen(tokens: readonly Token[], offset: number): number {
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined || token.span[0] > offset) break;
    if (token.kind === 'LPAREN') stack.push(index);
    else if (token.kind === 'RPAREN') stack.pop();
  }
  return stack[stack.length - 1] ?? -1;
}

function topLevelCommas(tokens: readonly Token[], openIndex: number, offset: number): number {
  let depth = 0;
  let commas = 0;
  for (let index = openIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined || token.span[0] > offset) break;
    switch (token.kind) {
      case 'LPAREN':
      case 'LBRACE':
      case 'LBRACKET':
        depth += 1;
        break;
      case 'RPAREN':
      case 'RBRACE':
      case 'RBRACKET':
        depth -= 1;
        break;
      case 'COMMA':
        if (depth === 0) commas += 1;
        break;
      default:
        break;
    }
  }
  return commas;
}

function calleeBefore(source: string, tokens: readonly Token[], openIndex: number): Callee | null {
  let index = openIndex - 1;
  let bang = false;
  if (tokens[index]?.kind === 'BANG') {
    bang = true;
    index -= 1;
  }
  const parts: string[] = [];
  while (index >= 0) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === 'IDENTIFIER') {
      parts.unshift(textOf(source, token));
      index -= 1;
    } else if (token.kind === 'DOT') {
      index -= 1;
    } else {
      break;
    }
  }
  if (parts.length === 0) return null;
  return { name: parts.join('.'), bang };
}

/** Token-based: the callee chain is preceded by `|`. Works on recovered parses. */
function isPipeStage(tokens: readonly Token[], openIndex: number): boolean {
  let index = openIndex - 1;
  if (tokens[index]?.kind === 'BANG') index -= 1;
  while (index >= 0) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === 'IDENTIFIER' || token.kind === 'DOT') {
      index -= 1;
      continue;
    }
    return token.kind === 'PIPE';
  }
  return false;
}

function nativeInfo(name: string, params: readonly string[], ret: string, piped: boolean): ResolvedSignature {
  const names = PARAM_NAMES[name.replace(/!$/, '')];
  let label = `${name}(`;
  const parameters: ParameterInformation[] = [];
  const entries: string[] = piped ? ['piped', ...params] : [...params];
  entries.forEach((type, index) => {
    const display = index === 0 && piped ? 'piped' : `${names?.[piped ? index - 1 : index] ?? `arg${piped ? index - 1 : index}`}: ${type}`;
    if (index > 0) label += ', ';
    const start = label.length;
    label += display;
    parameters.push({ label: [start, label.length] });
  });
  label += ')';
  if (ret !== 'any') label += ` -> ${ret}`;
  return { label, parameters };
}

function userInfo(name: string, params: readonly string[], piped: boolean): ResolvedSignature {
  const entries = piped ? ['piped', ...params] : [...params];
  let label = `fn ${name}(`;
  const parameters: ParameterInformation[] = [];
  entries.forEach((param, index) => {
    if (index > 0) label += ', ';
    const start = label.length;
    label += param;
    parameters.push({ label: [start, label.length] });
  });
  label += ')';
  return { label, parameters };
}

function resolveSignature(analysis: Analysis, callee: Callee, offset: number, piped: boolean): ResolvedSignature | null {
  if (callee.bang) {
    const signature = BANG_SIGNATURES[callee.name];
    return signature === undefined ? null : nativeInfo(`${callee.name}!`, signature.params, signature.ret, piped);
  }
  if (Object.hasOwn(PURE_SIGNATURES, callee.name)) {
    const signature = PURE_SIGNATURES[callee.name];
    return signature === undefined ? null : nativeInfo(callee.name, signature.params, signature.ret, piped);
  }
  if (callee.name.includes('.')) return null;
  const binder = analysis.binder;
  if (binder !== null) {
    const binding = visibleBindings(binder, offset).find((candidate) => candidate.name === callee.name);
    if (binding !== undefined) {
      if (binding.node !== null && binding.node.kind === 'FnDecl') {
        return userInfo(callee.name, binding.node.params.map((param) => param.id), piped);
      }
      const signature = binding.type.kind === 'function' ? binding.type.signature : null;
      if (signature !== null && !('ret' in signature)) return userInfo(callee.name, signature.params, piped);
    }
  }
  // Incomplete calls usually have no clean parse; fall back to the recovered AST.
  const program = analysis.core.program;
  if (program !== null) {
    const declarations = collectNodes<FnDecl>(program.body, 'FnDecl');
    const declaration = declarations.filter((candidate) => candidate.id === callee.name).pop();
    if (declaration !== undefined) return userInfo(callee.name, declaration.params.map((param) => param.id), piped);
  }
  return null;
}

export function signatureHelpAt(analysis: Analysis, offset: number): SignatureHelp | null {
  const tokens = analysis.core.tokens;
  const source = analysis.document.getText();
  const openIndex = innermostOpenParen(tokens, offset);
  if (openIndex === -1) return null;
  const callee = calleeBefore(source, tokens, openIndex);
  if (callee === null) return null;
  const signature = resolveSignature(analysis, callee, offset, isPipeStage(tokens, openIndex));
  if (signature === null) return null;
  const commas = topLevelCommas(tokens, openIndex, offset);
  const activeParameter = signature.parameters.length === 0 ? 0 : Math.min(commas, signature.parameters.length - 1);
  const information: SignatureInformation = { label: signature.label, parameters: signature.parameters };
  return { signatures: [information], activeSignature: 0, activeParameter };
}
