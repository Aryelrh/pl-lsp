import { describe, expect, it } from 'vitest';
import { analyze, type PlacitumError } from '../../src/analysis/core-adapter.js';
import { bind } from '../../src/analysis/binder.js';
import { checkProgram } from '../../src/analysis/checks.js';

function diagnosticsOf(source: string): PlacitumError[] {
  const core = analyze(source);
  const program = core.program;
  if (program === null || core.diagnostics.some((diagnostic) => diagnostic.phase === 'parse')) return [];
  return checkProgram(program, bind(program, source));
}

function codes(source: string): string[] {
  return diagnosticsOf(source).map((diagnostic) => diagnostic.code);
}

describe('definitely-certain checks', () => {
  const positives: [string, string[]][] = [
    ['let s = 1 + "a"\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = 2 + true\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = [1] + [2]\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = "a" - 1\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = "a" * 2\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = "a" < 1\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let x = 1\nx - "a"\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = -"a"\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = "x".y\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = [1].x\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let s = json.parse(1)\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['for x in "ab" { print!(x) }\n', ['E501_EVAL_TYPE_MISMATCH']],
    ['let n = 5\nn(1)\n', ['E502_EVAL_NOT_CALLABLE']],
    ['5(1)\n', ['E502_EVAL_NOT_CALLABLE']],
    ['let s = 1\ns("a")\n', ['E502_EVAL_NOT_CALLABLE']],
    ['fn f(a) {\n  return a\n}\nf(1, 2)\n', ['E503_EVAL_ARITY_MISMATCH']],
    ['json.parse("a", "b")\n', ['E503_EVAL_ARITY_MISMATCH']],
    ['needs net("a.com")\ncurl!()\n', ['E503_EVAL_ARITY_MISMATCH']],
    ['needs fs.read("a"), fs.write("b")\n"a" | fs.writeFile!()\n', ['E503_EVAL_ARITY_MISMATCH']],
    ['fn f(a, b) { return a }\n1 | f\n', ['E503_EVAL_ARITY_MISMATCH']],
    ['let q = 1 / 0\n', ['E504_EVAL_DIVISION_BY_ZERO']],
    ['let q = 1 / 0.0\n', ['E504_EVAL_DIVISION_BY_ZERO']],
  ];

  for (const [source, expected] of positives) {
    it(`reports ${expected.join(', ')} for ${JSON.stringify(source)}`, () => {
      expect(codes(source)).toEqual(expected);
    });
  }

  const negatives = [
    'let a = 1 + 2\n',
    'let b = "a" + "b"\n',
    'let c = 1 - 2\n',
    'let d = 1 / 2\n',
    'let e = 1 < 2\n',
    'let f = true == false\n',
    'let g = "a" == "b"\n',
    'let h = -1\n',
    'let i = json.parse("{}")\n',
    'let j = {}.x\n',
    'for x in [1] { print!(x) }\n',
    'fn f(a) { return a }\nf(1)\n',
    'needs fs.read("a")\n"a" | fs.readFile!()\n',
    'fn f(a) { return a }\n1 | f\n',
    '1 + x\n',
    '1 / x\n',
    'let x = 1\nlet y = -x\n',
  ];

  for (const source of negatives) {
    it(`stays silent for ${JSON.stringify(source)}`, () => {
      expect(codes(source)).toEqual([]);
    });
  }

  it('reports exact core message and span for the plus mismatch', () => {
    const [diagnostic] = diagnosticsOf('let s = 1 + "a"\n');
    expect(diagnostic).toMatchObject({
      code: 'E501_EVAL_TYPE_MISMATCH',
      message: 'operator "+" cannot combine number and string.',
      hint: 'Both operands must be numbers, or both strings.',
      location: { line: 1, col: 9, span: [8, 15] },
    });
  });

  it('reports the user-fn arity at the call site', () => {
    const [diagnostic] = diagnosticsOf('fn f(a) {\n  return a\n}\nf(1, 2)\n');
    expect(diagnostic).toMatchObject({
      code: 'E503_EVAL_ARITY_MISMATCH',
      message: 'fn `f` expects 1 argument(s), got 2.',
      location: { span: [23, 30] },
    });
  });

  it('skips all checks for a recovered parse', () => {
    expect(diagnosticsOf('let s = "abc\nlet t = 1 + "a"\n')).toEqual([]);
  });
});
