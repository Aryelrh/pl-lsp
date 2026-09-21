import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/analysis/core-adapter.js';
import { collectComments } from '../../src/analysis/comments.js';

function scan(source: string) {
  const core = analyze(source);
  return collectComments(source, core.tokens, []);
}

describe('collectComments', () => {
  it('returns the lexer comments when present', () => {
    const source = '# hi\nlet x = 1\n';
    const core = analyze(source);
    expect(collectComments(source, core.tokens, core.comments)).toEqual([{ span: [0, 4] }]);
  });

  it('finds comments and skips the line-1 pragma in the fallback scan', () => {
    const source = '#!strict\n# c\nlet x = 1\n';
    expect(scan(source)).toEqual([{ span: [source.indexOf('# c'), source.indexOf('# c') + 3] }]);
  });

  it('never treats # inside strings as a comment', () => {
    expect(scan('let x = "# not a comment"\n')).toEqual([]);
  });

  it('never treats # inside f-string text as a comment', () => {
    expect(scan('let s = f"a#b"\n')).toEqual([]);
  });

  it('yields at most one comment per line', () => {
    const source = '# a # b\n';
    expect(scan(source)).toEqual([{ span: [0, source.length - 1] }]);
  });

  it('finds a trailing comment', () => {
    const source = 'let x = 1 # tail\n';
    const hash = source.indexOf('#');
    expect(scan(source)).toEqual([{ span: [hash, source.length - 1] }]);
  });
});
