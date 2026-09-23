/**
 * Type inference for hover/completion/checks: mirrors core `inferType` plus
 * object shapes, json namespace members, and `curl!` results.
 */
import { BANG_SIGNATURES, PURE_SIGNATURES, signatureOf, type Expr, type Identifier, type NativeSig, type TypeName } from './core-adapter.js';

export type TypeInfo =
  | { kind: 'unknown' }
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'array'; element: TypeInfo }
  | { kind: 'object'; properties: Map<string, TypeInfo> }
  | { kind: 'function'; signature: NativeSig | { params: string[]; name?: string } | null }
  | { kind: 'namespace'; members: Map<string, TypeInfo> };

export type TypeResolver = (name: string, node: Identifier) => TypeInfo | undefined;

export function unknownType(): TypeInfo {
  return { kind: 'unknown' };
}

export function typeNameOf(type: TypeInfo): string {
  return type.kind;
}

export function functionParamCount(type: TypeInfo): number | null {
  if (type.kind !== 'function' || type.signature === null) return null;
  return type.signature.params.length;
}

/** Declared name of a user function type (native signatures carry none). */
export function functionName(type: TypeInfo): string | null {
  if (type.kind !== 'function' || type.signature === null) return null;
  const name = (type.signature as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

/** Short human label for hover/inlay hints. */
export function describeType(type: TypeInfo): string {
  switch (type.kind) {
    case 'array':
      return `array<${describeType(type.element)}>`;
    case 'function':
      return describeSignature(type) ?? 'function';
    default:
      return type.kind;
  }
}

/** `fn name(a, b)` for user functions, `(string) -> string` for native ones. */
export function describeSignature(type: TypeInfo): string | null {
  if (type.kind !== 'function' || type.signature === null) return null;
  const signature = type.signature;
  if (!('ret' in signature)) {
    const name = functionName(type);
    return name === null ? `fn(${signature.params.join(', ')})` : `fn ${name}(${signature.params.join(', ')})`;
  }
  return `(${signature.params.join(', ')}) -> ${signature.ret}`;
}

function fromTypeName(name: TypeName): TypeInfo {
  switch (name) {
    case 'array':
      return { kind: 'array', element: unknownType() };
    case 'object':
      return { kind: 'object', properties: new Map() };
    default:
      return { kind: name };
  }
}

function fromNativeSig(signature: NativeSig): TypeInfo {
  return signature.ret === 'any' ? unknownType() : fromTypeName(signature.ret);
}

/** `json.parse` is the only pure stdlib function exposed as a namespace member. */
export const JSON_NAMESPACE_TYPE: TypeInfo = {
  kind: 'namespace',
  members: new Map<string, TypeInfo>([
    ['parse', { kind: 'function', signature: PURE_SIGNATURES['json.parse'] ?? null }],
  ]),
};

/** Documented stdlib shape: curl! returns { status, body } (directive §6.4). */
const CURL_RESULT_TYPE: TypeInfo = {
  kind: 'object',
  properties: new Map<string, TypeInfo>([
    ['status', { kind: 'number' }],
    ['body', { kind: 'string' }],
  ]),
};

function arrayType(elements: Expr[], resolve: TypeResolver): TypeInfo {
  const first = elements[0];
  if (first === undefined) return { kind: 'array', element: unknownType() };
  const element = inferType(first, resolve);
  const uniform = elements.every((candidate) => inferType(candidate, resolve).kind === element.kind);
  return { kind: 'array', element: uniform ? element : unknownType() };
}

function objectType(properties: { key: string; value: Expr }[], resolve: TypeResolver): TypeInfo {
  return {
    kind: 'object',
    properties: new Map(properties.map((property) => [property.key, inferType(property.value, resolve)])),
  };
}

function memberType(object: TypeInfo, property: string): TypeInfo {
  switch (object.kind) {
    case 'unknown':
      return unknownType();
    case 'namespace':
      return object.members.get(property) ?? { kind: 'null' };
    case 'object':
      return object.properties.get(property) ?? { kind: 'null' };
    default:
      // Runtime reads of members on scalars/arrays throw E501; hover stays silent.
      return { kind: 'null' };
  }
}

function bangType(target: string): TypeInfo {
  if (target === 'curl') return CURL_RESULT_TYPE;
  if (Object.hasOwn(BANG_SIGNATURES, target)) {
    const signature = BANG_SIGNATURES[target];
    if (signature !== undefined) return fromNativeSig(signature);
  }
  return unknownType();
}

function callType(callee: Expr, resolve: TypeResolver): TypeInfo {
  const signature = signatureOf(callee);
  if (signature !== null) return fromNativeSig(signature);
  if (callee.kind === 'Identifier') {
    const type = resolve(callee.name, callee);
    if (type?.kind === 'function') return functionReturn(type);
  }
  return unknownType();
}

function functionReturn(type: TypeInfo): TypeInfo {
  if (type.kind !== 'function' || type.signature === null) return unknownType();
  const signature = type.signature;
  if (!('ret' in signature)) return unknownType();
  return signature.ret === 'any' ? unknownType() : fromTypeName(signature.ret);
}

/** Bare pipe stages call the referenced function; type the result, not the function. */
function stageResult(stage: Expr, resolve: TypeResolver): TypeInfo {
  if (stage.kind === 'Identifier' || stage.kind === 'MemberExpr') {
    const type = inferType(stage, resolve);
    if (type.kind === 'function') return functionReturn(type);
    return type;
  }
  return inferType(stage, resolve);
}

export function inferType(expr: Expr, resolve: TypeResolver): TypeInfo {
  switch (expr.kind) {
    case 'StringLiteral':
      return { kind: 'string' };
    case 'NumberLiteral':
      return { kind: 'number' };
    case 'BooleanLiteral':
      return { kind: 'boolean' };
    case 'NullLiteral':
      return { kind: 'null' };
    case 'FStringExpr':
      return { kind: 'string' };
    case 'ArrayLiteral':
      return arrayType(expr.elements, resolve);
    case 'ObjectLiteral':
      return objectType(expr.properties, resolve);
    case 'Identifier':
      return resolve(expr.name, expr) ?? unknownType();
    case 'MemberExpr':
      return memberType(inferType(expr.object, resolve), expr.property);
    case 'PipeExpr': {
      const last = expr.stages[expr.stages.length - 1];
      return last === undefined ? unknownType() : stageResult(last, resolve);
    }
    case 'BangCall':
      return bangType(expr.target);
    case 'CallExpr':
      return callType(expr.callee, resolve);
    case 'BinaryExpr': {
      if (expr.operator === '+') {
        const left = inferType(expr.left, resolve);
        const right = inferType(expr.right, resolve);
        if (left.kind === 'string' && right.kind === 'string') return { kind: 'string' };
        if (left.kind === 'number' && right.kind === 'number') return { kind: 'number' };
        return unknownType();
      }
      if (expr.operator === '-' || expr.operator === '*' || expr.operator === '/') return { kind: 'number' };
      return { kind: 'boolean' };
    }
    case 'UnaryExpr':
      return { kind: expr.operator === '-' ? 'number' : 'boolean' };
    case 'AssignExpr':
      return inferType(expr.value, resolve);
  }
}
