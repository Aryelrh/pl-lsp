import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, type Program } from '../../src/analysis/core-adapter.js';
import { bind, type BinderResult } from '../../src/analysis/binder.js';

function programOf(source: string): Program {
  const core = analyze(source);
  if (core.program === null) throw new Error(`fixture did not parse: ${JSON.stringify(core.diagnostics)}`);
  return core.program;
}

function bindOf(source: string): BinderResult {
  return bind(programOf(source), source);
}

function fixture(name: string): { source: string; expected: { code: string; message: string; hint?: string } } {
  return {
    source: readFileSync(new URL(`../fixtures/binder/${name}.placitum`, import.meta.url), 'utf8'),
    expected: JSON.parse(readFileSync(new URL(`../fixtures/binder/${name}.expected.json`, import.meta.url), 'utf8')) as {
      code: string;
      message: string;
      hint?: string;
    },
  };
}

describe('binder consistency with core eval-negatives', () => {
  const cases: [string, [number, number]][] = [
    ['e500-unbound-read', [11, 23]],
    ['e500-assign-unbound', [0, 18]],
    ['e506-let-redeclaration', [10, 19]],
    ['e506-fn-redeclaration', [26, 50]],
  ];

  for (const [name, span] of cases) {
    it(`matches ${name}`, () => {
      const { source, expected } = fixture(name);
      const binder = bindOf(source);
      expect(binder.diagnostics).toHaveLength(1);
      expect(binder.diagnostics[0]).toMatchObject({
        code: expected.code,
        span,
        message: expected.message,
        hint: expected.hint,
      });
    });
  }
});

describe('binder scopes', () => {
  it('does not resolve a let name inside its own initializer', () => {
    const source = 'let x = x\n';
    const diagnostics = bindOf(source).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'E500_EVAL_UNBOUND_VAR', span: [8, 9] });
  });

  it('resolves the outer binding when an inner let shadows it in its own initializer', () => {
    const source = 'let x = 1\nfn f() {\n  let x = x\n}\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const readOffset = source.indexOf('let x = x') + 'let x = '.length;
    const read = binder.occurrences.find((occurrence) => occurrence.span[0] === readOffset);
    expect(read?.mode).toBe('read');
    expect(binder.bindings[read?.binding ?? -1]?.declSpan[0]).toBe(0);
  });

  it('lets closures capture bindings declared later in the enclosing scope', () => {
    const source = 'fn f() { return g() }\nfn g() { return 1 }\n';
    expect(bindOf(source).diagnostics).toEqual([]);
  });

  it('does not flag use-before-let within the same scope', () => {
    expect(bindOf('let y = z\nlet z = 1\n').diagnostics).toEqual([]);
  });

  it('treats fn parameters and body lets as one scope', () => {
    const diagnostics = bindOf('fn f(x) { let x = 1 }\n').diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'E506_EVAL_REDECLARATION', span: [10, 19] });
  });

  it('collides with the json builtin in the program scope', () => {
    const diagnostics = bindOf('let json = 1\n').diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('E506_EVAL_REDECLARATION');
  });

  it('allows shadowing in inner scopes', () => {
    const source = 'let x = 1\nif true {\n  let x = 2\n}\nlet y = x\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const lets = binder.bindings.filter((binding) => binding.name === 'x');
    expect(lets).toHaveLength(2);
    const readOffset = source.lastIndexOf('x');
    const read = binder.occurrences.filter((occurrence) => occurrence.span[0] === readOffset);
    expect(read).toHaveLength(1);
    expect(read[0]?.binding).toBe(lets[0]?.id);
  });

  it('scopes the for iterator to the loop', () => {
    const source = 'for i in [1, 2] { let i = 3 }\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const iterator = binder.bindings.find((binding) => binding.kind === 'iterator');
    expect(iterator?.name).toBe('i');
    expect(iterator?.type.kind).toBe('number');
    const inner = binder.bindings.find((binding) => binding.kind === 'let');
    expect(inner?.scope).not.toBe(iterator?.scope);
  });

  it('resolves recursion through the fn name binding', () => {
    const source = 'fn f(n) { return f(n) }\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const readOffset = source.indexOf('return ') + 'return '.length;
    const read = binder.occurrences.find((occurrence) => occurrence.span[0] === readOffset);
    expect(read?.mode).toBe('read');
    expect(binder.bindings[read?.binding ?? -1]?.kind).toBe('fn');
  });

  it('records assignment targets as write occurrences', () => {
    const source = 'let x = 1\nx = 2\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const target = binder.occurrences.find((occurrence) => occurrence.span[0] === source.lastIndexOf('x'));
    expect(target?.mode).toBe('write');
  });

  it('reports assignment to an undeclared name with the core message', () => {
    const diagnostics = bindOf('unknown_target = 5\n').diagnostics;
    expect(diagnostics[0]?.message).toBe('assignment to `unknown_target` finds no declared binding in any enclosing scope.');
  });

  it('never declares effectful bang targets', () => {
    const source = 'needs net("a.com")\nlet r = curl!("https://a.com")\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    expect(binder.occurrences).toEqual([]);
  });

  it('records a read occurrence when a user binding shadows a bang target', () => {
    const source = 'let save = 1\nsave!(1)\n';
    const binder = bindOf(source);
    const occurrence = binder.occurrences.find((candidate) => candidate.span[0] === source.lastIndexOf('save!'));
    expect(occurrence?.mode).toBe('read');
    expect(binder.bindings[occurrence?.binding ?? -1]?.name).toBe('save');
  });

  it('walks f-string interpolations', () => {
    const source = 'let x = 1\nlet s = f"value {x}"\n';
    const binder = bindOf(source);
    expect(binder.diagnostics).toEqual([]);
    const readOffset = source.indexOf('{x}') + 1;
    const occurrence = binder.occurrences.find((candidate) => candidate.span[0] === readOffset);
    expect(binder.bindings[occurrence?.binding ?? -1]?.name).toBe('x');
  });

  it('never treats member properties or object keys as bindings', () => {
    const source = 'let obj = { a: 1 }\nlet v = obj.a\n';
    const binder = bindOf(source);
    expect(binder.occurrences.map((occurrence) => occurrence.span[0])).toEqual([source.lastIndexOf('obj')]);
  });

  it('infers binding types from initializers', () => {
    const source = [
      'let n = 5',
      'let s = "a"',
      'let a = [1, 2]',
      'let mixed = [1, "a"]',
      'let o = { x: 1 }',
      'let p = json.parse("{}")',
      'for k in ["a"] { let v = k }',
      '',
    ].join('\n');
    const binder = bindOf(source);
    const byName = (name: string) => binder.bindings.find((binding) => binding.name === name);
    expect(byName('n')?.type.kind).toBe('number');
    expect(byName('s')?.type.kind).toBe('string');
    expect(byName('a')?.type).toMatchObject({ kind: 'array', element: { kind: 'number' } });
    expect(byName('mixed')?.type).toMatchObject({ kind: 'array', element: { kind: 'unknown' } });
    expect(byName('o')?.type.kind).toBe('object');
    expect(byName('p')?.type.kind).toBe('unknown');
    expect(byName('k')?.type.kind).toBe('string');
  });
});
