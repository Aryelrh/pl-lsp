/** Document and workspace symbol extraction; pure except the caller's file scan. */
import {
  SymbolKind,
  type DocumentSymbol,
  type Range,
  type SymbolInformation,
  type WorkspaceSymbol,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, type Program, type Statement } from '../analysis/core-adapter.js';
import { nameSpanIn } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';

function rangeOf(analysis: Analysis, span: readonly [number, number]): Range {
  return spanToRange(analysis.document, span);
}

function needsSymbol(analysis: Analysis, needs: { span: readonly [number, number]; tokens: readonly { span: readonly [number, number] }[] }): DocumentSymbol {
  const source = analysis.document.getText();
  return {
    name: 'needs',
    kind: SymbolKind.Namespace,
    range: rangeOf(analysis, needs.span),
    selectionRange: rangeOf(analysis, needs.span),
    children: needs.tokens.map((token) => ({
      name: source.slice(token.span[0], token.span[1]),
      kind: SymbolKind.Property,
      range: rangeOf(analysis, token.span),
      selectionRange: rangeOf(analysis, token.span),
    })),
  };
}

/**
 * Nested statements without a symbol of their own (if/while/for bodies) flatten
 * into the nearest enclosing symbol's children, or the top level if none wraps
 * them. Stable by construction: the walk order is the source order.
 */
function statementsToSymbols(analysis: Analysis, statements: readonly Statement[]): DocumentSymbol[] {
  const source = analysis.document.getText();
  const symbols: DocumentSymbol[] = [];
  for (const statement of statements) {
    switch (statement.kind) {
      case 'NeedsDecl':
        symbols.push(needsSymbol(analysis, statement));
        break;
      case 'FnDecl': {
        const children: DocumentSymbol[] = statement.params.map((param) => ({
          name: param.id,
          kind: SymbolKind.Variable,
          range: rangeOf(analysis, param.span),
          selectionRange: rangeOf(analysis, param.span),
        }));
        children.push(...statementsToSymbols(analysis, statement.body.body));
        symbols.push({
          name: statement.id,
          kind: SymbolKind.Function,
          range: rangeOf(analysis, statement.span),
          selectionRange: rangeOf(analysis, nameSpanIn(source, statement.span[0], statement.id)),
          children,
        });
        break;
      }
      case 'LetStmt':
        symbols.push({
          name: statement.id,
          kind: SymbolKind.Variable,
          range: rangeOf(analysis, statement.span),
          selectionRange: rangeOf(analysis, nameSpanIn(source, statement.span[0], statement.id)),
        });
        break;
      case 'ForStmt':
        symbols.push({
          name: statement.iterator,
          kind: SymbolKind.Variable,
          range: rangeOf(analysis, statement.span),
          selectionRange: rangeOf(analysis, nameSpanIn(source, statement.span[0], statement.iterator)),
        });
        symbols.push(...statementsToSymbols(analysis, statement.body.body));
        break;
      case 'IfStmt':
        symbols.push(...statementsToSymbols(analysis, statement.consequent.body));
        if (statement.alternate !== null) {
          if (statement.alternate.kind === 'IfStmt') symbols.push(...statementsToSymbols(analysis, [statement.alternate]));
          else symbols.push(...statementsToSymbols(analysis, statement.alternate.body));
        }
        break;
      case 'WhileStmt':
        symbols.push(...statementsToSymbols(analysis, statement.body.body));
        break;
      default:
        break;
    }
  }
  return symbols;
}

function flattenSymbols(uri: string, symbols: readonly DocumentSymbol[], container: string | null): SymbolInformation[] {
  const out: SymbolInformation[] = [];
  for (const symbol of symbols) {
    const info: SymbolInformation = { name: symbol.name, kind: symbol.kind, location: { uri, range: symbol.range } };
    if (container !== null) info.containerName = container;
    out.push(info);
    if (symbol.children !== undefined) out.push(...flattenSymbols(uri, symbol.children, symbol.name));
  }
  return out;
}

export function documentSymbols(analysis: Analysis, hierarchical: boolean): DocumentSymbol[] | SymbolInformation[] {
  const program = analysis.core.program;
  const tree: DocumentSymbol[] = [];
  for (const needs of program?.needs ?? []) tree.push(needsSymbol(analysis, needs));
  tree.push(...statementsToSymbols(analysis, program?.body ?? []));
  return hierarchical ? tree : flattenSymbols(analysis.uri, tree, null);
}

function makeWorkspaceSymbol(
  document: TextDocument,
  uri: string,
  containerName: string,
  name: string,
  kind: SymbolKind,
  span: readonly [number, number],
): WorkspaceSymbol {
  const symbol: WorkspaceSymbol = { name, kind, location: { uri, range: spanToRange(document, span) } };
  if (containerName !== '') symbol.containerName = containerName;
  return symbol;
}

/**
 * Top-level fn/let names for workspace symbols. Half-typed files fall back to
 * a line regex so they still contribute something (directive §7.7).
 */
export function workspaceSymbolsFromSource(uri: string, source: string, containerName: string): WorkspaceSymbol[] {
  const core = analyze(source);
  const document = TextDocument.create(uri, 'placitum', 0, source);
  const program: Program | null = core.program;
  const parseFailed = program === null || core.diagnostics.some((diagnostic) => diagnostic.phase === 'parse');
  const symbols: WorkspaceSymbol[] = [];
  if (!parseFailed && program !== null) {
    for (const statement of program.body) {
      if (statement.kind === 'LetStmt' || statement.kind === 'FnDecl') {
        const kind = statement.kind === 'FnDecl' ? SymbolKind.Function : SymbolKind.Variable;
        symbols.push(makeWorkspaceSymbol(document, uri, containerName, statement.id, kind, nameSpanIn(source, statement.span[0], statement.id)));
      }
    }
    return symbols;
  }
  const pattern = /^\s*(fn|let)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (;;) {
    const match = pattern.exec(source);
    if (match === null) break;
    const name = match[2];
    if (name === undefined) continue;
    const start = match.index + match[0].length - name.length;
    const kind = match[1] === 'fn' ? SymbolKind.Function : SymbolKind.Variable;
    symbols.push(makeWorkspaceSymbol(document, uri, containerName, name, kind, [start, start + name.length]));
  }
  return symbols;
}
