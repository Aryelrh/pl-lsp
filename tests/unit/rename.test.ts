import { describe, expect, it } from 'vitest';
import { ResponseError } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { prepareRenameAt, renameAt } from '../../src/features/rename.js';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

function editLines(edit: ReturnType<typeof renameAt>, uri = 'file:///test.placitum'): number[] {
  const edits = edit?.changes?.[uri] ?? [];
  return edits.map((textEdit) => textEdit.range.start.line);
}

describe('prepareRenameAt', () => {
  it('returns the identifier range and placeholder', () => {
    const source = 'let value = 1\nlet copy = value\n';
    const analysis = analysisOf(source);
    const prepared = prepareRenameAt(analysis, source.indexOf('value'));
    expect(prepared.placeholder).toBe('value');
    expect(prepared.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
  });

  it('refuses builtins, effectful names, keywords and broken parses', () => {
    const builtin = analysisOf('let y = json\n');
    expect(() => prepareRenameAt(builtin, builtin.document.getText().lastIndexOf('json'))).toThrow(ResponseError);
    const effectful = analysisOf('needs net("a.com")\nlet r = curl!("https://a.com")\n');
    expect(() => prepareRenameAt(effectful, effectful.document.getText().indexOf('curl'))).toThrow(/cannot be renamed/);
    const keyword = analysisOf('let x = 1\n');
    expect(() => prepareRenameAt(keyword, 0)).toThrow(ResponseError);
    const broken = analysisOf('let x = "abc\n');
    expect(() => prepareRenameAt(broken, 5)).toThrow(/not fully parsed/);
  });
});

describe('renameAt', () => {
  it('renames a shadowed param without touching the outer binding', () => {
    const source = 'let x = 1\nfn f(x) {\n  return x\n}\nlet y = x\n';
    const analysis = analysisOf(source);
    const paramOffset = source.indexOf('fn f(x)') + 'fn f('.length;
    const edit = renameAt(analysis, paramOffset, 'z');
    expect(editLines(edit)).toEqual([1, 2]);
    const edits = edit?.changes?.['file:///test.placitum'] ?? [];
    expect(edits).toHaveLength(2);
    expect(edits.every((textEdit) => textEdit.newText === 'z')).toBe(true);
  });

  it('renames an outer binding without touching the shadowed inner one', () => {
    const source = 'let x = 1\nfn f(x) {\n  return x\n}\nlet y = x\n';
    const analysis = analysisOf(source);
    const edit = renameAt(analysis, source.indexOf('x'), 'outer');
    expect(editLines(edit)).toEqual([0, 4]);
  });

  it('renames fn names, iterators and f-string occurrences', () => {
    const fn = analysisOf('fn f(n) { return f(n) }\n');
    expect(editLines(renameAt(fn, fn.document.getText().indexOf('fn f') + 'fn '.length, 'g'))).toEqual([0, 0]);

    const loop = analysisOf('for i in [1] { let v = i }\n');
    expect(editLines(renameAt(loop, loop.document.getText().indexOf('i'), 'j'))).toEqual([0, 0]);

    const fstring = analysisOf('let x = 1\nlet s = f"{x}"\n');
    expect(editLines(renameAt(fstring, fstring.document.getText().indexOf('x'), 'y'))).toEqual([0, 1]);
  });

  it('rejects invalid names, keywords and same-scope collisions', () => {
    const analysis = analysisOf('let a = 1\nlet b = 2\n');
    const offset = analysis.document.getText().indexOf('b');
    expect(() => renameAt(analysis, offset, '1bad')).toThrow(/not a valid Placitum identifier/);
    expect(() => renameAt(analysis, offset, 'a-b')).toThrow(/not a valid Placitum identifier/);
    expect(() => renameAt(analysis, offset, 'let')).toThrow(/reserved keyword/);
    expect(() => renameAt(analysis, offset, 'a')).toThrow(/would redeclare/);
  });

  it('returns null for a no-op rename', () => {
    const analysis = analysisOf('let a = 1\n');
    expect(renameAt(analysis, analysis.document.getText().indexOf('a'), 'a')).toBeNull();
  });
});
