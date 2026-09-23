import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat, type CompletionItem } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { completeAt, type CompletionOptions } from '../../src/features/completion.js';

const SNIPPETS: CompletionOptions = { snippets: true, markdown: true };

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

function complete(source: string, needle: string, after = 0, options: CompletionOptions = SNIPPETS): CompletionItem[] | null {
  const analysis = analysisOf(source);
  return completeAt(analysis, source.indexOf(needle) + needle.length + after, options);
}

function labels(items: CompletionItem[] | null): string[] {
  return (items ?? []).map((item) => item.label);
}

function byLabel(items: CompletionItem[] | null, label: string): CompletionItem | undefined {
  return (items ?? []).find((item) => item.label === label);
}

describe('completion contexts', () => {
  it('offers the strict pragma on line 1', () => {
    const items = complete('#!', '');
    expect(labels(items)).toEqual(['strict']);
    expect(items?.[0]?.kind).toBe(CompletionItemKind.Keyword);
  });

  it('offers capability starters and existing tokens inside needs', () => {
    const source = 'needs fs.read("/etc/**"), net("a.com")\n';
    const items = complete(source, 'needs ');
    const names = labels(items);
    expect(names).toEqual(expect.arrayContaining(['fs.read', 'fs.write', 'net', 'exec', 'env', 'only']));
    expect(names).toEqual(expect.arrayContaining(['fs.read("/etc/**")', 'net("a.com")']));
    expect(byLabel(items, 'fs.read')?.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it('offers read/write after fs. inside needs', () => {
    expect(labels(complete('needs fs.', 'needs fs.'))).toEqual(['read', 'write']);
  });

  it('offers the enclosing grants after only(', () => {
    const source = 'needs net("a.com"), fs.read("/etc/**")\nfn f() needs only(\n';
    const names = labels(complete(source, 'only('));
    expect(names).toEqual(expect.arrayContaining(['net("a.com")', 'fs.read("/etc/**")']));
  });

  it('offers declared env names after env(', () => {
    const source = 'needs env(API_KEY)\nlet x = env(\n';
    expect(labels(complete(source, 'env('))).toEqual(['API_KEY']);
  });

  it('offers json and object members after a dot', () => {
    expect(labels(complete('let x = json.parse("{}")\nlet y = json.\n', 'json.\n', -1))).toEqual(['parse']);
    expect(labels(complete('let r = curl!("https://a.com")\nlet s = r.\n', 'r.\n', -1)).sort()).toEqual(['body', 'status']);
    expect(labels(complete('let n = 1\nlet s = n.\n', 'n.\n', -1))).toEqual([]);
  });

  it('offers pipe stages after |', () => {
    const source = 'fn transform(a) { return a }\nneeds fs.read("a")\n"a" | \n';
    const names = labels(complete(source, '| '));
    expect(names).toEqual(expect.arrayContaining(['transform', 'json.parse', 'fs.readFile', 'curl']));
    expect(byLabel(complete(source, '| '), 'transform')?.detail).toContain('fn transform');
  });

  it('offers locals, stdlib, keywords and snippets in general position', () => {
    const source = 'fn load(path) { return path }\nlet cfg = 1\nlet c';
    const items = complete(source, 'let c', 0);
    expect(byLabel(items, 'cfg')?.sortText).toBe('0'); // exact prefix
    expect(byLabel(items, 'load')?.kind).toBe(CompletionItemKind.Function);
    expect(byLabel(items, 'json')?.kind).toBe(CompletionItemKind.Module);
    expect(byLabel(items, 'let')?.kind).toBe(CompletionItemKind.Keyword);
    expect(byLabel(items, 'fs.readFile')?.insertText).toBe('fs.readFile!(${1})');
    expect(byLabel(items, 'fs.readFile')?.filterText).toBe('fs.readFile');
    expect(byLabel(items, 'fs.readFile')?.detail).toBe('capability-aware');
    expect(byLabel(items, 'json.parse')?.detail).toBe('pure');
    expect(byLabel(items, 'print')?.detail).toBe('ambient');
    expect((items ?? []).some((item) => item.label === 'if' && item.kind === CompletionItemKind.Snippet)).toBe(true);
  });

  it('replaces the partial identifier with a text edit', () => {
    const source = 'let value = 1\nlet val';
    const analysis = analysisOf(source);
    const items = completeAt(analysis, source.lastIndexOf('let val') + 'let val'.length, SNIPPETS);
    const value = byLabel(items, 'value');
    expect(value?.textEdit).toEqual({
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 7 } },
      newText: 'value',
    });
  });

  it('returns null inside strings, f-string text and comments', () => {
    expect(complete('let x = "abc\n', '"')).toBeNull();
    expect(complete('let s = f"abc"\n', 'f"')).toBeNull();
    expect(complete('# a comment\n', '# ')).toBeNull();
  });

  it('still helps with recovered parses', () => {
    const source = 'fn helper(a) { return a }\nlet x = \n';
    expect(labels(complete(source, 'let x = '))).toEqual(expect.arrayContaining(['helper']));
  });

  it('omits snippets when disabled', () => {
    const source = 'let cfg = 1\nlet c';
    const items = complete(source, 'let c', 0, { snippets: false, markdown: false });
    expect(byLabel(items, 'fs.readFile')?.insertText).toBeUndefined();
    expect((items ?? []).some((item) => item.kind === CompletionItemKind.Snippet)).toBe(false);
    expect(byLabel(items, 'if')?.kind).toBe(CompletionItemKind.Keyword);
  });

  it('never throws on broken input', () => {
    for (const source of ['', '"unterminated', 'fn', 'let x = @']) {
      expect(() => complete(source, source)).not.toThrow();
    }
  });
});
