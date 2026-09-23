import { describe, expect, it } from 'vitest';
import { analyze, type Expr } from '../../src/analysis/core-adapter.js';
import {
  JSON_NAMESPACE_TYPE,
  functionName,
  functionParamCount,
  inferType,
  type TypeInfo,
  type TypeResolver,
} from '../../src/analysis/types.js';

function exprOf(expression: string): Expr {
  const program = analyze(`let value = ${expression}\n`).program;
  const statement = program?.body[0];
  if (statement === undefined || statement.kind !== 'LetStmt') throw new Error(`cannot parse: ${expression}`);
  return statement.init;
}

function typed(expression: string, table: Record<string, TypeInfo> = {}): TypeInfo {
  const resolver: TypeResolver = (name) => table[name];
  return inferType(exprOf(expression), resolver);
}

describe('inferType', () => {
  it('types literals and f-strings', () => {
    expect(typed('1').kind).toBe('number');
    expect(typed('""').kind).toBe('string');
    expect(typed('true').kind).toBe('boolean');
    expect(typed('null').kind).toBe('null');
    expect(typed('f"x{1}"').kind).toBe('string');
  });

  it('types arrays with best-effort element types', () => {
    expect(typed('[1, 2]')).toMatchObject({ kind: 'array', element: { kind: 'number' } });
    expect(typed('[]')).toMatchObject({ kind: 'array', element: { kind: 'unknown' } });
    expect(typed('[1, "a"]')).toMatchObject({ kind: 'array', element: { kind: 'unknown' } });
  });

  it('types object literals with their properties', () => {
    const type = typed('{ x: 1, y: "a" }');
    expect(type.kind).toBe('object');
    if (type.kind !== 'object') throw new Error('expected object');
    expect(type.properties.get('x')?.kind).toBe('number');
    expect(type.properties.get('y')?.kind).toBe('string');
  });

  it('resolves identifiers through the resolver', () => {
    expect(typed('v', { v: { kind: 'number' } }).kind).toBe('number');
    expect(typed('unknown_name').kind).toBe('unknown');
  });

  it('reads members from known object shapes and namespaces', () => {
    const object: TypeInfo = {
      kind: 'object',
      properties: new Map([['x', { kind: 'number' }]]),
    };
    expect(typed('o.x', { o: object }).kind).toBe('number');
    expect(typed('o.missing', { o: object }).kind).toBe('null');
    expect(typed('json', { json: JSON_NAMESPACE_TYPE }).kind).toBe('namespace');
    expect(typed('json.parse', { json: JSON_NAMESPACE_TYPE }).kind).toBe('function');
    expect(typed('json.parse("{}")', { json: JSON_NAMESPACE_TYPE }).kind).toBe('unknown');
    expect(typed('o.x', {}).kind).toBe('unknown');
    expect(typed('"x".y').kind).toBe('null');
  });

  it('uses the documented bang signatures', () => {
    expect(typed('fs.readFile!("/x")').kind).toBe('string');
    expect(typed('fs.writeFile!("/x", "y")').kind).toBe('null');
    expect(typed('print!("x")').kind).toBe('null');
    expect(typed('eprint!("x")').kind).toBe('null');
    expect(typed('unknown_bang!()').kind).toBe('unknown');
    const curl = typed('curl!("https://a.com")');
    expect(curl.kind).toBe('object');
    if (curl.kind !== 'object') throw new Error('expected object');
    expect(curl.properties.get('status')?.kind).toBe('number');
    expect(curl.properties.get('body')?.kind).toBe('string');
  });

  it('types pipe results from the last stage', () => {
    expect(typed('1 | json.parse', { json: JSON_NAMESPACE_TYPE }).kind).toBe('unknown');
    expect(typed('"a" | json.parse', { json: JSON_NAMESPACE_TYPE }).kind).toBe('unknown');
    const f: TypeInfo = { kind: 'function', signature: { params: ['a'], name: 'f' } };
    expect(typed('1 | f', { f }).kind).toBe('unknown');
    const value: TypeInfo = { kind: 'string' };
    expect(typed('1 | identity', { identity: { kind: 'function', signature: null } }).kind).toBe('unknown');
    expect(typed('true | stringify', { stringify: { kind: 'function', signature: { params: [], ret: 'string' } } }).kind).toBe('string');
    expect(typed('v', { v: value }).kind).toBe('string');
  });

  it('mirrors core binary and unary typing', () => {
    expect(typed('1 + 2').kind).toBe('number');
    expect(typed('"a" + "b"').kind).toBe('string');
    expect(typed('1 + "a"').kind).toBe('unknown');
    expect(typed('1 - 2').kind).toBe('number');
    expect(typed('1 * 2').kind).toBe('number');
    expect(typed('1 / 2').kind).toBe('number');
    expect(typed('1 < 2').kind).toBe('boolean');
    expect(typed('1 == 2').kind).toBe('boolean');
    expect(typed('true && false').kind).toBe('boolean');
    expect(typed('-1').kind).toBe('number');
    expect(typed('not true').kind).toBe('boolean');
    expect(typed('x = 1', { x: { kind: 'number' } }).kind).toBe('number');
  });

  it('exposes function helpers for user and native signatures', () => {
    const user: TypeInfo = { kind: 'function', signature: { params: ['a', 'b'], name: 'f' } };
    const native: TypeInfo = { kind: 'function', signature: { params: ['string'], ret: 'string' } };
    expect(functionParamCount(user)).toBe(2);
    expect(functionName(user)).toBe('f');
    expect(functionParamCount(native)).toBe(1);
    expect(functionName(native)).toBeNull();
    expect(functionParamCount({ kind: 'number' })).toBeNull();
  });
});
