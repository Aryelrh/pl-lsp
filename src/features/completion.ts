/** Context-aware completion (directive §7.3); pure. */
import { CompletionItemKind, InsertTextFormat, type CompletionItem, type Range } from 'vscode-languageserver/node.js';
import {
  AMBIENT_BANGS,
  BANG_REGISTRY,
  BANG_SIGNATURES,
  EFFECTFUL_STDLIB,
  PURE_SIGNATURES,
  type FnDecl,
  type LetStmt,
  type NeedsDecl,
  type PipeExpr,
  type Program,
  type Token,
} from '../analysis/core-adapter.js';
import { bindingAt, typeResolver, visibleBindings, type Binding } from '../analysis/binder.js';
import { manifestTokenTexts, parentManifestOf } from '../analysis/capabilities.js';
import type { Analysis } from '../analysis/model.js';
import { JSON_NAMESPACE_TYPE, describeSignature, describeType, inferType, type TypeInfo } from '../analysis/types.js';
import { collectNodes } from '../analysis/walk.js';

export interface CompletionOptions {
  snippets: boolean;
  markdown: boolean;
}

const STRING_TOKEN_KINDS = new Set(['STRING', 'STRING_CHUNK', 'FSTRING_START', 'FSTRING_END']);
const KEYWORDS = ['let', 'fn', 'if', 'while', 'for', 'return', 'needs'];
const STATEMENT_SNIPPETS: [string, string, string][] = [
  ['if', 'if ${1:condition} {\n\t$0\n}', 'if block'],
  ['while', 'while ${1:condition} {\n\t$0\n}', 'while loop'],
  ['for', 'for ${1:item} in ${2:items} {\n\t$0\n}', 'for loop'],
  ['fn', 'fn ${1:name}(${2}) {\n\t$0\n}', 'function declaration'],
  ['needs', 'needs ${1:fs.read("${2:/path/**}")}', 'needs declaration'],
];
const CAPABILITY_STARTERS: [string, string, string][] = [
  ['fs.read', 'fs.read("${1:/path/**}")', 'fs.read capability'],
  ['fs.write', 'fs.write("${1:/path/**}")', 'fs.write capability'],
  ['net', 'net("${1:api.example.com}")', 'net capability'],
  ['exec', 'exec("${1:/usr/bin/*}")', 'exec capability'],
  ['env', 'env(${1:NAME})', 'env capability'],
  ['only', 'only(${1:capability})', 'attenuate grants'],
];

function textOf(source: string, token: Token): string {
  return source.slice(token.span[0], token.span[1]);
}

function previousToken(tokens: readonly Token[], offset: number): Token | undefined {
  let result: Token | undefined;
  for (const token of tokens) {
    if (token.kind === 'EOF' || token.kind === 'NEWLINE') continue;
    if (token.span[1] > offset) break;
    result = token;
  }
  return result;
}

function tokenBefore(tokens: readonly Token[], target: Token): Token | undefined {
  const index = tokens.indexOf(target);
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const token = tokens[cursor];
    if (token === undefined) break;
    if (token.kind === 'NEWLINE' || token.kind === 'EOF') continue;
    return token;
  }
  return undefined;
}

function partialStart(source: string, offset: number): number {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(source.charAt(start - 1))) start -= 1;
  return start;
}

function insideLiteralOrComment(analysis: Analysis, offset: number): boolean {
  for (const comment of analysis.comments) {
    if (offset >= comment.span[0] && offset <= comment.span[1]) return true;
  }
  for (const token of analysis.core.tokens) {
    if (!STRING_TOKEN_KINDS.has(token.kind)) continue;
    if (offset >= token.span[0] && offset <= token.span[1]) return true;
  }
  return false;
}

/** Line-1 `#!` is a pragma even before it lexes as one (E105 until named). */
function isPragmaContext(analysis: Analysis, offset: number): boolean {
  const source = analysis.document.getText();
  if (!source.startsWith('#!')) return false;
  if (analysis.document.positionAt(offset).line !== 0) return false;
  const newline = source.indexOf('\n');
  return offset <= (newline === -1 ? source.length : newline);
}

function needsAt(program: Program | null, offset: number): NeedsDecl | null {
  if (program === null) return null;
  for (const needs of collectNodes<NeedsDecl>(program, 'NeedsDecl')) {
    if (offset >= needs.span[0] && offset <= needs.span[1]) return needs;
  }
  return null;
}

/** Token fallback for half-typed needs lines (`needs fs.` has no parsed NeedsDecl). */
function onNeedsLine(tokens: readonly Token[], offset: number): boolean {
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token === undefined || token.span[0] >= offset) continue;
    if (token.kind === 'NEWLINE' || token.kind === 'EOF') break;
    if (token.kind === 'NEEDS') return true;
  }
  return false;
}

function envNames(program: Program | null): string[] {
  const names = new Set<string>();
  if (program !== null) {
    for (const needs of collectNodes<NeedsDecl>(program, 'NeedsDecl')) {
      for (const token of needs.tokens) if (token.kind === 'EnvCapability') names.add(token.name);
    }
  }
  return [...names];
}

function rawCapabilityTokens(analysis: Analysis, program: Program | null): string[] {
  const source = analysis.document.getText();
  const raw = new Set<string>();
  if (program !== null) {
    for (const needs of collectNodes<NeedsDecl>(program, 'NeedsDecl')) {
      for (const token of needs.tokens) raw.add(source.slice(token.span[0], token.span[1]));
    }
  }
  return [...raw];
}

function producedType(analysis: Analysis, offset: number): TypeInfo | null {
  const program = analysis.core.program;
  const binder = analysis.binder;
  if (program === null || binder === null) return null;
  const resolve = typeResolver(binder);
  for (const pipe of collectNodes<PipeExpr>(program.body, 'PipeExpr')) {
    if (offset < pipe.span[0] || offset > pipe.span[1]) continue;
    const index = pipe.stages.findIndex((stage) => offset >= stage.span[0] && offset <= stage.span[1]);
    const previous = index > 0 ? pipe.stages[index - 1] : undefined;
    if (previous !== undefined) return inferType(previous, resolve);
  }
  return null;
}

function matchesFirstParam(type: TypeInfo, produced: TypeInfo): boolean {
  if (type.kind !== 'function' || type.signature === null) return false;
  const expected = type.signature.params[0];
  if (expected === undefined || expected === 'any' || expected === 'unknown') return false;
  return produced.kind === expected;
}

function documentationOf(item: CompletionItem, markdown: boolean, text: string): CompletionItem {
  if (markdown) item.documentation = { kind: 'markdown', value: text };
  else item.documentation = text;
  return item;
}

function categoryHint(category: string): string {
  switch (category) {
    case 'net':
      return 'net(...)';
    case 'fsRead':
      return 'fs.read(...)';
    case 'fsWrite':
      return 'fs.write(...)';
    default:
      return 'exec(...)';
  }
}

function bindingItem(binding: Binding, options: CompletionOptions): CompletionItem {
  if (binding.kind === 'builtin') {
    return { label: binding.name, kind: CompletionItemKind.Module, detail: 'builtin namespace', sortText: '2' };
  }
  if (binding.kind === 'fn') {
    const signature = describeSignature(binding.type);
    const item: CompletionItem = {
      label: binding.name,
      kind: CompletionItemKind.Function,
      detail: signature ?? 'function',
      sortText: '1',
    };
    if (options.snippets) {
      item.insertText = `${binding.name}($1)`;
      item.insertTextFormat = InsertTextFormat.Snippet;
    }
    return item;
  }
  return {
    label: binding.name,
    kind: CompletionItemKind.Variable,
    detail: describeType(binding.type),
    sortText: '1',
  };
}

function stdlibItem(name: string, effectful: boolean, options: CompletionOptions, matched: boolean): CompletionItem {
  const signature = effectful ? BANG_SIGNATURES[name] : PURE_SIGNATURES[name];
  const placeholders = signature === undefined ? '$1' : signature.params.map((_, index) => `\${${index + 1}}`).join(', ');
  const call = effectful ? `${name}!(${placeholders})` : `${name}(${placeholders})`;
  const item: CompletionItem = {
    label: name,
    filterText: name,
    kind: CompletionItemKind.Function,
    detail: effectful ? 'capability-aware' : 'pure',
    sortText: matched ? '0' : '3',
  };
  if (options.snippets) {
    item.insertText = call;
    item.insertTextFormat = InsertTextFormat.Snippet;
  }
  if (effectful) {
    const category = BANG_REGISTRY[name];
    if (category !== undefined) {
      const text = `Requires: \`${categoryHint(category)}\`\n\n\`\`\`placitum\n${call}\n\`\`\``;
      documentationOf(item, options.markdown, text);
    }
  } else if (signature !== undefined) {
    documentationOf(item, options.markdown, `\`\`\`placitum\n${name}(${signature.params.join(', ')}) -> ${signature.ret}\n\`\`\``);
  }
  return item;
}

function ambientItem(name: string, options: CompletionOptions): CompletionItem {
  const item: CompletionItem = {
    label: name,
    filterText: name,
    kind: CompletionItemKind.Function,
    detail: 'ambient',
    sortText: '3',
  };
  if (options.snippets) {
    item.insertText = `${name}!($1)`;
    item.insertTextFormat = InsertTextFormat.Snippet;
  }
  return item;
}

function simpleItem(label: string, kind: CompletionItemKind, detail: string, sortText: string, insertText?: string, snippet = false): CompletionItem {
  const item: CompletionItem = { label, kind, detail, sortText };
  if (insertText !== undefined) {
    item.insertText = insertText;
    if (snippet) item.insertTextFormat = InsertTextFormat.Snippet;
  }
  return item;
}

function generalCandidates(analysis: Analysis, offset: number, options: CompletionOptions): CompletionItem[] {
  const items: CompletionItem[] = [];
  const binder = analysis.binder;
  if (binder !== null) {
    for (const binding of visibleBindings(binder, offset)) items.push(bindingItem(binding, options));
  } else if (analysis.core.program !== null) {
    // Recovered parse: offer the declarations we can still see.
    items.push({ label: 'json', kind: CompletionItemKind.Module, detail: 'builtin namespace', sortText: '2' });
    for (const fn of collectNodes<FnDecl>(analysis.core.program.body, 'FnDecl')) items.push(declarationItem(fn, options));
    for (const declaration of collectNodes<LetStmt>(analysis.core.program.body, 'LetStmt')) {
      if (declaration.span[0] >= offset) continue;
      items.push({
        label: declaration.id,
        kind: CompletionItemKind.Variable,
        detail: describeType(inferType(declaration.init, () => undefined)),
        sortText: '1',
      });
    }
  }
  for (const name of EFFECTFUL_STDLIB) items.push(stdlibItem(name, true, options, false));
  for (const name of AMBIENT_BANGS) items.push(ambientItem(name, options));
  for (const name of Object.keys(PURE_SIGNATURES)) items.push(stdlibItem(name, false, options, false));
  for (const keyword of KEYWORDS) items.push(simpleItem(keyword, CompletionItemKind.Keyword, 'keyword', '2'));
  if (options.snippets) {
    for (const [label, insertText, detail] of STATEMENT_SNIPPETS) {
      items.push(simpleItem(label, CompletionItemKind.Snippet, detail, '3', insertText, true));
    }
  }
  return items;
}

function needsCandidates(analysis: Analysis, program: Program | null, options: CompletionOptions): CompletionItem[] {
  const items: CompletionItem[] = [];
  if (options.snippets) {
    for (const [label, insertText, detail] of CAPABILITY_STARTERS) {
      items.push(simpleItem(label, CompletionItemKind.Function, detail, '3', insertText, true));
    }
  }
  for (const raw of rawCapabilityTokens(analysis, program)) {
    items.push(simpleItem(raw, CompletionItemKind.Value, 'existing capability', '3'));
  }
  return items;
}

function topGrantTokens(analysis: Analysis): string[] {
  const program = analysis.core.program;
  if (program === null) return [];
  const source = analysis.document.getText();
  const tokens: string[] = [];
  for (const needs of program.needs) {
    for (const token of needs.tokens) tokens.push(source.slice(token.span[0], token.span[1]));
  }
  return tokens;
}

function onlyCandidates(analysis: Analysis, needs: NeedsDecl | null): CompletionItem[] {
  const items: CompletionItem[] = [];
  if (analysis.capabilities !== null) {
    const fn = needs === null ? undefined : analysis.capabilities.fns.find((candidate) => candidate.needs === needs);
    const manifest = fn === undefined ? analysis.capabilities.manifest : parentManifestOf(analysis.capabilities, fn);
    if (manifest !== null) {
      for (const text of manifestTokenTexts(manifest)) {
        items.push(simpleItem(text, CompletionItemKind.Function, 'enclosing grant', '1'));
      }
      return items;
    }
  }
  for (const text of topGrantTokens(analysis)) {
    items.push(simpleItem(text, CompletionItemKind.Function, 'enclosing grant', '1'));
  }
  return items;
}

function declarationItem(fn: FnDecl, options: CompletionOptions): CompletionItem {
  const params = fn.params.map((param) => param.id).join(', ');
  const item: CompletionItem = {
    label: fn.id,
    kind: CompletionItemKind.Function,
    detail: `fn ${fn.id}(${params})`,
    sortText: '1',
  };
  if (options.snippets) {
    item.insertText = `${fn.id}($1)`;
    item.insertTextFormat = InsertTextFormat.Snippet;
  }
  return item;
}

/** Receiver type for `x.`: binder when the parse is clean, recovered AST otherwise. */
function memberReceiverType(analysis: Analysis, before: Token, offset: number): TypeInfo | undefined {
  const binder = analysis.binder;
  if (binder !== null) {
    const hit = bindingAt(binder, before.span[0]);
    if (hit !== null) return hit.binding.type;
  }
  const name = textOf(analysis.document.getText(), before);
  if (name === 'json') return JSON_NAMESPACE_TYPE;
  const program = analysis.core.program;
  if (program === null) return undefined;
  const declarations = collectNodes<LetStmt>(program.body, 'LetStmt').filter(
    (candidate) => candidate.id === name && candidate.span[0] < offset,
  );
  const declaration = declarations[declarations.length - 1];
  return declaration === undefined ? undefined : inferType(declaration.init, () => undefined);
}

function memberCandidates(analysis: Analysis, offset: number): CompletionItem[] | null {
  const tokens = analysis.core.tokens;
  const previous = previousToken(tokens, offset);
  if (previous === undefined || previous.kind !== 'DOT') return null;
  const before = tokenBefore(tokens, previous);
  if (before === undefined || before.kind !== 'IDENTIFIER') return [];
  const type = memberReceiverType(analysis, before, offset);
  if (type === undefined) return [];
  if (type.kind === 'namespace') {
    return [...type.members.entries()].map(([name, memberType]) =>
      simpleItem(name, CompletionItemKind.Property, describeType(memberType), '1'),
    );
  }
  if (type.kind === 'object') {
    return [...type.properties.entries()].map(([name, propertyType]) =>
      simpleItem(name, CompletionItemKind.Property, describeType(propertyType), '1'),
    );
  }
  return [];
}

function pipeCandidates(analysis: Analysis, offset: number, options: CompletionOptions): CompletionItem[] | null {
  const previous = previousToken(analysis.core.tokens, offset);
  if (previous?.kind !== 'PIPE') return null;
  const produced = producedType(analysis, offset);
  const items: CompletionItem[] = [];
  const binder = analysis.binder;
  if (binder !== null) {
    for (const binding of visibleBindings(binder, offset)) {
      if (binding.kind !== 'fn') continue;
      items.push(bindingItem(binding, options));
    }
  } else if (analysis.core.program !== null) {
    for (const fn of collectNodes<FnDecl>(analysis.core.program.body, 'FnDecl')) items.push(declarationItem(fn, options));
  }
  for (const name of Object.keys(PURE_SIGNATURES)) {
    const signature = PURE_SIGNATURES[name];
    const matched = produced !== null && signature !== undefined && matchesFirstParam({ kind: 'function', signature }, produced);
    items.push(stdlibItem(name, false, options, matched));
  }
  for (const name of EFFECTFUL_STDLIB) {
    const signature = BANG_SIGNATURES[name];
    const matched = produced !== null && signature !== undefined && matchesFirstParam({ kind: 'function', signature }, produced);
    items.push(stdlibItem(name, true, options, matched));
  }
  return items;
}

function finalize(items: CompletionItem[], prefix: string, range: Range): CompletionItem[] {
  const needle = prefix.toLowerCase();
  for (const item of items) {
    item.textEdit = { range, newText: item.insertText ?? item.label };
    if (needle !== '' && (item.filterText ?? item.label).toLowerCase().startsWith(needle)) item.sortText = '0';
  }
  items.sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '') || a.label.localeCompare(b.label));
  return items;
}

export function completeAt(analysis: Analysis, offset: number, options: CompletionOptions): CompletionItem[] | null {
  const source = analysis.document.getText();
  const start = partialStart(source, offset);
  const prefix = source.slice(start, offset);
  const range: Range = { start: analysis.document.positionAt(start), end: analysis.document.positionAt(offset) };

  if (isPragmaContext(analysis, offset)) {
    return finalize([simpleItem('strict', CompletionItemKind.Keyword, 'strict pipe-chain checks', '2')], prefix, range);
  }
  if (insideLiteralOrComment(analysis, offset)) return null;

  const program = analysis.core.program;
  const needs = needsAt(program, offset);
  if (needs !== null || onNeedsLine(analysis.core.tokens, offset)) {
    const previous = previousToken(analysis.core.tokens, offset);
    const before = previous === undefined ? undefined : tokenBefore(analysis.core.tokens, previous);
    if (previous?.kind === 'DOT' && before?.kind === 'IDENTIFIER' && textOf(source, before) === 'fs') {
      return finalize(
        [
          simpleItem('read', CompletionItemKind.Property, 'fs.read capability', '2'),
          simpleItem('write', CompletionItemKind.Property, 'fs.write capability', '2'),
        ],
        prefix,
        range,
      );
    }
    if (previous?.kind === 'LPAREN' && before?.kind === 'ONLY') {
      return finalize(onlyCandidates(analysis, needs), prefix, range);
    }
    if (previous?.kind === 'LPAREN' && before?.kind === 'IDENTIFIER' && textOf(source, before) === 'env') {
      const items = envNames(program).map((name) => simpleItem(name, CompletionItemKind.Variable, 'env variable', '1'));
      return finalize(items, prefix, range);
    }
    return finalize(needsCandidates(analysis, program, options), prefix, range);
  }

  const member = memberCandidates(analysis, offset);
  if (member !== null) return finalize(member, prefix, range);
  const pipe = pipeCandidates(analysis, offset, options);
  if (pipe !== null) return finalize(pipe, prefix, range);
  return finalize(generalCandidates(analysis, offset, options), prefix, range);
}
