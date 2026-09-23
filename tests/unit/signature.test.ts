import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { signatureHelpAt } from '../../src/features/signature.js';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, source));
}

function help(source: string, needle: string, after = 0) {
  const analysis = analysisOf(source);
  return signatureHelpAt(analysis, source.indexOf(needle) + needle.length + after);
}

describe('signatureHelpAt', () => {
  it('resolves user functions with named parameters and the active argument', () => {
    const source = 'fn f(a, b) { return a }\nf(1, 2)\n';
    const result = help(source, 'f(1, ');
    expect(result?.signatures[0]?.label).toBe('fn f(a, b)');
    expect(result?.signatures[0]?.parameters).toEqual([
      { label: [5, 6] },
      { label: [8, 9] },
    ]);
    expect(result?.activeParameter).toBe(1);
  });

  it('works while the call is still incomplete', () => {
    const source = 'fn f(a, b) { return a }\nf(1, ';
    const result = help(source, 'f(1, ');
    expect(result?.signatures[0]?.label).toBe('fn f(a, b)');
    expect(result?.activeParameter).toBe(1);
  });

  it('resolves stdlib pure and effectful signatures', () => {
    expect(help('let x = json.parse(', 'json.parse(')?.signatures[0]?.label).toBe('json.parse(text: string) -> unknown');
    expect(help('needs fs.read("a")\nfs.readFile!(', 'fs.readFile!(')?.signatures[0]?.label).toBe('fs.readFile!(path: string) -> string');
  });

  it('prepends the piped parameter for pipe stages', () => {
    const bang = help('needs fs.read("a")\n"a" | fs.readFile!(', 'fs.readFile!(');
    expect(bang?.signatures[0]?.label).toBe('fs.readFile!(piped, path: string) -> string');
    const user = help('fn f(a, b) { return a }\n1 | f(', '| f(');
    expect(user?.signatures[0]?.label).toBe('fn f(piped, a, b)');
  });

  it('returns null outside an argument list or for unknown callees', () => {
    expect(help('let x = 1\n', '1')).toBeNull();
    expect(help('unknown_fn(', 'unknown_fn(')).toBeNull();
    expect(help('1 + (2', '1 + (')).toBeNull();
  });
});
