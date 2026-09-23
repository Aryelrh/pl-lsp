import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { referencesAt } from '../../src/features/references.js';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

describe('referencesAt', () => {
  it('includes reads, writes and the declaration', () => {
    const source = 'let x = 1\nx = 2\nlet y = x\n';
    const analysis = analysisOf(source);
    const withDeclaration = referencesAt(analysis, source.indexOf('x'), true);
    expect(withDeclaration.map((location) => location.range.start.line)).toEqual([0, 1, 2]);
    const withoutDeclaration = referencesAt(analysis, source.indexOf('x'), false);
    expect(withoutDeclaration.map((location) => location.range.start.line)).toEqual([1, 2]);
  });

  it('is scope-aware for shadowed bindings', () => {
    const source = 'let x = 1\nfn f(x) { return x }\nlet y = x\n';
    const analysis = analysisOf(source);
    const outer = referencesAt(analysis, source.indexOf('x'), true);
    expect(outer.map((location) => location.range.start.line)).toEqual([0, 2]);
    const paramOffset = source.indexOf('fn f(x)') + 'fn f('.length;
    const param = referencesAt(analysis, paramOffset, true);
    expect(param.map((location) => location.range.start.line)).toEqual([1, 1]);
    expect(param[0]?.range.start.character).toBe(5);
  });

  it('returns nothing for builtins, effectful names and unresolved identifiers', () => {
    const builtin = analysisOf('let y = json\n');
    expect(referencesAt(builtin, builtin.document.getText().lastIndexOf('json'), true)).toEqual([]);
    const effectful = analysisOf('needs net("a.com")\nlet r = curl!("https://a.com")\n');
    expect(referencesAt(effectful, effectful.document.getText().indexOf('curl'), true)).toEqual([]);
    const broken = analysisOf('let x = "abc\n');
    expect(referencesAt(broken, 5, true)).toEqual([]);
  });
});
