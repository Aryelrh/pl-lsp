import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { foldingRanges } from '../../src/features/folding.js';
import { highlightsAt } from '../../src/features/highlights.js';
import { selectionRanges } from '../../src/features/selection.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

describe('foldingRanges', () => {
  it('folds blocks, literals, needs groups and comment runs', () => {
    const ranges = foldingRanges(analysisOf(rosetta));
    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startLine: 4, endLine: 7, kind: 'region' }),
        expect.objectContaining({ startLine: 15, endLine: 17, kind: 'region' }),
      ]),
    );
  });

  it('folds multi-line arrays and consecutive comments', () => {
    const source = '# one\n# two\nlet items = [\n  1,\n  2\n]\n';
    const ranges = foldingRanges(analysisOf(source));
    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startLine: 0, endLine: 1, kind: 'comment' }),
        expect.objectContaining({ startLine: 2, endLine: 5, kind: 'region' }),
      ]),
    );
  });

  it('folds consecutive top-level needs lines as one region', () => {
    const source = 'needs net("a.com")\nneeds fs.read("/etc/**")\nlet x = 1\n';
    expect(foldingRanges(analysisOf(source))).toEqual([
      expect.objectContaining({ startLine: 0, endLine: 1, kind: 'region' }),
    ]);
  });

  it('falls back to brace matching when the file does not parse', () => {
    const source = 'let x = "abc\nfn f() {\n  let y = 1\n}\n';
    expect(foldingRanges(analysisOf(source))).toEqual([expect.objectContaining({ startLine: 1, endLine: 3 })]);
  });
});

describe('selectionRanges', () => {
  it('nests token, expression, statement, block and program', () => {
    const source = 'fn f() {\n  let value = 1 + 2\n}\n';
    const [selection] = selectionRanges(analysisOf(source), [{ line: 1, character: 16 }]);
    const ranges: string[] = [];
    for (let node = selection; node !== undefined; node = node.parent) {
      ranges.push(`${node.range.start.line}:${node.range.start.character}-${node.range.end.line}:${node.range.end.character}`);
    }
    expect(ranges[ranges.length - 1]).toBe('0:0-3:0');
    expect(ranges.length).toBeGreaterThanOrEqual(4);
  });

  it('returns one chain per requested position and falls back without an AST', () => {
    const selections = selectionRanges(analysisOf('let x = "abc\n'), [
      { line: 0, character: 5 },
      { line: 0, character: 2 },
    ]);
    expect(selections).toHaveLength(2);
    expect(selections[0]?.range.start.line).toBe(0);
  });
});

describe('highlightsAt', () => {
  it('marks reads and writes of the binding under the cursor', () => {
    const source = 'let x = 1\nx = 2\nlet y = x\n';
    const analysis = analysisOf(source);
    const highlights = highlightsAt(analysis, source.indexOf('x = 2'));
    expect(highlights).toHaveLength(2);
    expect(highlights[0]).toMatchObject({ range: { start: { line: 1, character: 0 } }, kind: 3 });
    expect(highlights[1]).toMatchObject({ range: { start: { line: 2, character: 8 } }, kind: 2 });
  });

  it('has no highlights for builtins, members or broken parses', () => {
    const builtin = analysisOf('let y = json\n');
    expect(highlightsAt(builtin, builtin.document.getText().lastIndexOf('json'))).toEqual([]);
    const member = analysisOf('let obj = { key: 1 }\nlet v = obj.key\n');
    expect(highlightsAt(member, member.document.getText().lastIndexOf('key'))).toEqual([]);
    const broken = analysisOf('let x = "abc\n');
    expect(highlightsAt(broken, 5)).toEqual([]);
  });
});
