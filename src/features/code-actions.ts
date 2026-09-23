/**
 * Deterministic quick fixes for lex/parse/extract/binder diagnostics
 * (directive §7.10). Pure: recomputed from the analysis, never from client text.
 */
import {
  CodeActionKind,
  type CodeAction,
  type Command,
  type Diagnostic,
  type Position,
  type Range,
  type WorkspaceEdit,
} from 'vscode-languageserver/node.js';
import {
  BANG_REGISTRY,
  type BangCall,
  type CallExpr,
  type CapabilityToken,
  type EffectCategory,
  type Statement,
  type Token,
} from '../analysis/core-adapter.js';
import { nameSpanIn } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { collectNodes } from '../analysis/walk.js';

export type CodeActionResult = CodeAction | Command;

interface Fix {
  title: string;
  edit: WorkspaceEdit;
  preferred: boolean;
}

const STATEMENT_KINDS = ['LetStmt', 'FnDecl', 'IfStmt', 'WhileStmt', 'ForStmt', 'ReturnStmt', 'ExprStmt', 'NeedsDecl'];

function edit(analysis: Analysis, range: Range, newText: string): WorkspaceEdit {
  return { changes: { [analysis.uri]: [{ range, newText }] } };
}

function rangeOf(analysis: Analysis, span: readonly [number, number]): Range {
  const text = analysis.document.getText();
  const start = Math.max(0, Math.min(span[0], text.length));
  const end = Math.max(start, Math.min(span[1], text.length));
  return { start: analysis.document.positionAt(start), end: analysis.document.positionAt(end) };
}

function offsetOf(analysis: Analysis, position: Position): number {
  return analysis.document.offsetAt(position);
}

function diagnosticSpan(analysis: Analysis, diagnostic: Diagnostic): [number, number] {
  return [offsetOf(analysis, diagnostic.range.start), offsetOf(analysis, diagnostic.range.end)];
}

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

function rangesIntersect(a: Range, b: Range): boolean {
  return !before(a.end, b.start) && !before(b.end, a.start);
}

function lineStart(analysis: Analysis, offset: number): number {
  return analysis.document.offsetAt({ line: analysis.document.positionAt(offset).line, character: 0 });
}

function lineIndent(analysis: Analysis, offset: number): string {
  const start = lineStart(analysis, offset);
  const text = analysis.document.getText().slice(start);
  return /^[ \t]*/.exec(text)?.[0] ?? '';
}

function endOfLine(analysis: Analysis, line: number): number {
  return analysis.document.offsetAt({ line, character: Number.MAX_SAFE_INTEGER });
}

/** Offset just past the line's terminator (or the line end when there is none). */
function afterLineBreak(analysis: Analysis, line: number): number {
  const end = endOfLine(analysis, line);
  const text = analysis.document.getText();
  if (text.startsWith('\r\n', end)) return end + 2;
  if (text[end] === '\n' || text[end] === '\r') return end + 1;
  return end;
}

/** First backticked token of a message; binder messages always name the binding. */
function quotedName(message: string): string | null {
  return /`([^`]+)`/.exec(message)?.[1] ?? null;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tokenBase(token: CapabilityToken): Exclude<CapabilityToken, { kind: 'OnlyCapability' }> {
  return token.kind === 'OnlyCapability' ? token.inner : token;
}

function tokenKey(token: CapabilityToken): string | null {
  const base = tokenBase(token);
  switch (base.kind) {
    case 'FsReadCapability':
      return `fsRead:${base.pattern}`;
    case 'FsWriteCapability':
      return `fsWrite:${base.pattern}`;
    case 'NetCapability':
      return `net:${base.pattern}`;
    case 'ExecCapability':
      return `exec:${base.pattern}`;
    case 'EnvCapability':
      return `env:${base.name}`;
  }
}

interface NeedsToken {
  category: EffectCategory;
  key: string;
  text: string;
}

/** Capability token text exactly as the extractor would record it. */
function needsTokenFor(target: string, value: string): NeedsToken | null {
  const category = Object.hasOwn(BANG_REGISTRY, target) ? BANG_REGISTRY[target] : undefined;
  if (category === undefined) return null;
  switch (category) {
    case 'net': {
      let hostname: string;
      try {
        hostname = new URL(value).hostname;
      } catch {
        return null;
      }
      return { category, key: `net:${hostname}`, text: `net("${escapeString(hostname)}")` };
    }
    case 'fsRead':
      return { category, key: `fsRead:${value}`, text: `fs.read("${escapeString(value)}")` };
    case 'fsWrite':
      return { category, key: `fsWrite:${value}`, text: `fs.write("${escapeString(value)}")` };
    case 'exec':
      return { category, key: `exec:${value}`, text: `exec("${escapeString(value)}")` };
  }
}

function bangAt(analysis: Analysis, span: readonly [number, number]): BangCall | null {
  const program = analysis.core.program;
  if (program === null) return null;
  return (
    collectNodes<BangCall>(program.body, 'BangCall').find(
      (bang) => bang.span[0] === span[0] && bang.span[1] === span[1],
    ) ?? null
  );
}

function addNeedsFix(analysis: Analysis, diagnostic: Diagnostic): Fix | null {
  const program = analysis.core.program;
  if (program === null) return null;
  const bang = bangAt(analysis, diagnosticSpan(analysis, diagnostic));
  if (bang === null) return null;
  const argument = bang.args[0];
  if (argument === undefined || argument.kind !== 'StringLiteral') return null;
  const token = needsTokenFor(bang.target, argument.value);
  if (token === null) return null;

  const present = new Set<string>();
  for (const needs of program.needs) for (const existing of needs.tokens) {
    const key = tokenKey(existing);
    if (key !== null) present.add(key);
  }
  if (present.has(token.key)) return null;

  const last = program.needs[program.needs.length - 1];
  if (last !== undefined) {
    return {
      title: `Add needs ${token.text}`,
      edit: edit(analysis, rangeOf(analysis, [last.span[1], last.span[1]]), `, ${token.text}`),
      preferred: true,
    };
  }
  const pragma = analysis.core.tokens.some(
    (candidate) => candidate.kind === 'PRAGMA' && analysis.document.positionAt(candidate.span[0]).line === 0,
  );
  const offset = pragma ? afterLineBreak(analysis, 0) : 0;
  const prefix = pragma && offset === endOfLine(analysis, 0) ? '\n' : '';
  return {
    title: `Add needs ${token.text}`,
    edit: edit(analysis, rangeOf(analysis, [offset, offset]), `${prefix}needs ${token.text}\n`),
    preferred: true,
  };
}

function enclosingStatement(analysis: Analysis, offset: number): Statement | null {
  const program = analysis.core.program;
  if (program === null) return null;
  let best: Statement | null = null;
  for (const kind of STATEMENT_KINDS) {
    for (const statement of collectNodes<Statement>(program.body, kind)) {
      if (offset < statement.span[0] || offset >= statement.span[1]) continue;
      if (best === null || statement.span[1] - statement.span[0] < best.span[1] - best.span[0]) best = statement;
    }
  }
  return best;
}

function isCallCallee(analysis: Analysis, span: readonly [number, number]): boolean {
  const program = analysis.core.program;
  if (program === null) return false;
  return collectNodes<CallExpr>(program.body, 'CallExpr').some(
    (call) => call.callee.span[0] === span[0] && call.callee.span[1] === span[1],
  );
}

function declareFix(analysis: Analysis, diagnostic: Diagnostic): Fix | null {
  const name = quotedName(diagnostic.message);
  if (name === null) return null;
  const span = diagnosticSpan(analysis, diagnostic);
  const statement = enclosingStatement(analysis, span[0]);
  if (statement === null) return null;

  if (isCallCallee(analysis, span)) {
    const text = analysis.document.getText();
    const offset = text.length;
    const prefix = text.endsWith('\n') ? '' : '\n';
    return {
      title: `Define function \`fn ${name}() { }\``,
      edit: edit(analysis, rangeOf(analysis, [offset, offset]), `${prefix}fn ${name}() {\n}\n`),
      preferred: false,
    };
  }

  if (statement.kind === 'ExprStmt' && statement.expression.kind === 'AssignExpr' && statement.expression.id === name) {
    const start = lineStart(analysis, statement.span[0]) + lineIndent(analysis, statement.span[0]).length;
    return {
      title: `Declare \`${name}\` with \`let\``,
      edit: edit(analysis, rangeOf(analysis, [start, start]), 'let '),
      preferred: true,
    };
  }

  const start = lineStart(analysis, statement.span[0]);
  const indent = lineIndent(analysis, statement.span[0]);
  return {
    title: `Declare \`${name}\` with \`let\``,
    edit: edit(analysis, rangeOf(analysis, [start, start]), `let ${name} = null\n${indent}`),
    preferred: true,
  };
}

function renameRedeclarationFix(analysis: Analysis, diagnostic: Diagnostic): Fix | null {
  const binder = analysis.binder;
  const name = quotedName(diagnostic.message);
  if (binder === null || name === null) return null;
  const [start] = diagnosticSpan(analysis, diagnostic);
  const nameSpan = nameSpanIn(analysis.document.getText(), start, name);
  const binding = binder.bindings.find((candidate) => candidate.name === name && candidate.nameSpan[0] < nameSpan[0]);
  if (binding === undefined) return null;
  const scope = binder.scopes[binding.scope];
  let counter = 2;
  let candidate = `${name}_${counter}`;
  while (scope?.bindings.has(candidate) === true) {
    counter += 1;
    candidate = `${name}_${counter}`;
  }
  return {
    title: `Rename to \`${candidate}\``,
    edit: edit(analysis, rangeOf(analysis, nameSpan), candidate),
    preferred: false,
  };
}

function whitespaceBeforeBangFix(analysis: Analysis, diagnostic: Diagnostic): Fix | null {
  if (!diagnostic.message.startsWith('Whitespace is not allowed')) return null;
  const [start] = diagnosticSpan(analysis, diagnostic);
  let previous: Token | null = null;
  for (const token of analysis.core.tokens) {
    if (token.kind === 'EOF' || token.kind === 'NEWLINE') continue;
    if (token.span[1] <= start) previous = token;
    else break;
  }
  if (previous === null || previous.kind !== 'IDENTIFIER') return null;
  const between = analysis.document.getText().slice(previous.span[1], start);
  if (between.length === 0 || !/^\s+$/.test(between)) return null;
  return {
    title: 'Remove whitespace before `!`',
    edit: edit(analysis, rangeOf(analysis, [previous.span[1], start]), ''),
    preferred: true,
  };
}

function closingQuoteFix(analysis: Analysis, diagnostic: Diagnostic): Fix {
  const line = diagnostic.range.start.line;
  const offset = endOfLine(analysis, line);
  return {
    title: 'Insert closing `"`',
    edit: edit(analysis, rangeOf(analysis, [offset, offset]), '"'),
    preferred: true,
  };
}

function closingBraceFix(analysis: Analysis): Fix {
  const text = analysis.document.getText();
  const offset = text.length;
  const prefix = text.endsWith('\n') ? '' : '\n';
  return {
    title: 'Insert `}` at end of file',
    edit: edit(analysis, rangeOf(analysis, [offset, offset]), `${prefix}}`),
    preferred: true,
  };
}

function fixFor(analysis: Analysis, diagnostic: Diagnostic): Fix | null {
  switch (diagnostic.code) {
    case 'E101_LEX_UNTERMINATED_STRING':
      return closingQuoteFix(analysis, diagnostic);
    case 'E104_LEX_UNEXPECTED_CHARACTER':
      return whitespaceBeforeBangFix(analysis, diagnostic);
    case 'E203_PARSE_UNTERMINATED_BLOCK':
      return closingBraceFix(analysis);
    case 'E301_EXTRACT_UNCOVERED_CAPABILITY':
      return addNeedsFix(analysis, diagnostic);
    case 'E500_EVAL_UNBOUND_VAR':
      return declareFix(analysis, diagnostic);
    case 'E506_EVAL_REDECLARATION':
      return renameRedeclarationFix(analysis, diagnostic);
    default:
      return null;
  }
}

function toCodeAction(fix: Fix): CodeAction {
  const action: CodeAction = { title: fix.title, kind: CodeActionKind.QuickFix, edit: fix.edit };
  if (fix.preferred) action.isPreferred = true;
  return action;
}

/** Quick fixes for every diagnostic intersecting `range`, plus command actions. */
export function codeActionsAt(analysis: Analysis, range: Range, diagnostics: readonly Diagnostic[]): CodeActionResult[] {
  const results: CodeActionResult[] = [];
  let hit = false;
  for (const diagnostic of diagnostics) {
    if (!rangesIntersect(diagnostic.range, range)) continue;
    hit = true;
    const fix = fixFor(analysis, diagnostic);
    if (fix !== null) results.push(toCodeAction(fix));
  }
  if (hit) {
    results.push({
      title: 'Show capability manifest',
      command: 'placitum.showManifest',
      arguments: [analysis.uri],
    });
  }
  return results;
}
