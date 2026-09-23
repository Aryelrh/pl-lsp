import { readFileSync } from 'node:fs';
import { SymbolKind, type DocumentSymbol, type SymbolInformation } from 'vscode-languageserver/node.js';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { documentSymbols, workspaceSymbolsFromSource } from '../../src/features/symbols.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

function names(symbols: readonly DocumentSymbol[]): string[] {
  return symbols.map((symbol) => symbol.name);
}

describe('documentSymbols', () => {
  it('builds a hierarchical tree for the rosetta fixture', () => {
    const symbols = documentSymbols(analysisOf(rosetta), true) as DocumentSymbol[];
    expect(names(symbols)).toEqual(['needs', 'load', 'cfg', 'parsed', 'response', 'key']);
    const needs = symbols[0];
    expect(needs?.kind).toBe(SymbolKind.Namespace);
    expect(needs?.children?.map((child) => child.name)).toEqual([
      'fs.read("/etc/**")',
      'net("api.example.com")',
      'env(API_KEY?)',
      'exec("/usr/bin/*")',
    ]);
    const load = symbols[1];
    expect(load?.kind).toBe(SymbolKind.Function);
    expect(load?.children?.map((child) => child.name)).toEqual(['path', 'data']);
    expect(symbols[5]?.kind).toBe(SymbolKind.Variable);
  });

  it('flattens to SymbolInformation with container names', () => {
    const flat = documentSymbols(analysisOf(rosetta), false) as SymbolInformation[];
    expect(flat.map((symbol) => symbol.name)).toContain('load');
    expect(flat.find((symbol) => symbol.name === 'data')?.containerName).toBe('load');
    expect(flat.find((symbol) => symbol.name === 'needs')?.containerName).toBeUndefined();
    expect(flat.find((symbol) => symbol.name === 'fs.read("/etc/**")')?.containerName).toBe('needs');
  });

  it('flattens nested blocks into the nearest enclosing symbol or the top level', () => {
    const source = 'if true {\n  let inner = 1\n}\nfn f() {\n  if true {\n    let nested = 2\n  }\n}\n';
    const tree = documentSymbols(analysisOf(source), true) as DocumentSymbol[];
    expect(names(tree)).toEqual(['inner', 'f']);
    expect(names(tree[1]?.children ?? [])).toEqual(['nested']);
  });

  it('has no symbols for a file with syntax errors beyond the parse fallback', () => {
    const tree = documentSymbols(analysisOf('let x = "abc\n'), true) as DocumentSymbol[];
    expect(tree).toEqual([]);
  });
});

describe('workspaceSymbolsFromSource', () => {
  it('extracts top-level fn/let names with container names', () => {
    const source = 'fn alpha(a) { return a }\nlet beta = 1\nfn nested() {\n  let hidden = 2\n}\n';
    const symbols = workspaceSymbolsFromSource('file:///w/x.placitum', source, 'x.placitum');
    expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ['alpha', SymbolKind.Function],
      ['beta', SymbolKind.Variable],
      ['nested', SymbolKind.Function],
    ]);
    expect(symbols.every((symbol) => symbol.containerName === 'x.placitum')).toBe(true);
  });

  it('falls back to a line regex when the file does not parse', () => {
    const source = 'let x = "abc\nfn half() {\n  return 1\n}\n';
    const symbols = workspaceSymbolsFromSource('file:///w/broken.placitum', source, 'broken.placitum');
    expect(symbols.map((symbol) => symbol.name)).toEqual(['x', 'half']);
  });
});
