/**
 * Definitely-certain static E5xx checks (§6.5): only constructs that fail on
 * every execution path are reported; anything uncertain stays silent.
 */
import { BANG_SIGNATURES, signatureOf, type BangCall, type BinaryExpr, type CallExpr, type Expr, type Identifier, type MemberExpr, type PlacitumError, type Program, type Statement, type UnaryExpr } from './core-adapter.js';
import type { BinderResult, Binding, Occurrence } from './binder.js';
import { functionName, functionParamCount, inferType, unknownType, typeNameOf, type TypeInfo, type TypeResolver } from './types.js';

interface Located {
  readonly line: number;
  readonly col: number;
  readonly span: readonly [number, number];
}

interface CheckContext {
  readonly occurrences: Map<number, Occurrence>;
  readonly bindings: Map<number, Binding>;
}

type Code = 'E501_EVAL_TYPE_MISMATCH' | 'E502_EVAL_NOT_CALLABLE' | 'E503_EVAL_ARITY_MISMATCH' | 'E504_EVAL_DIVISION_BY_ZERO';

function report(errors: PlacitumError[], code: Code, node: Located, message: string, hint: string): void {
  errors.push({
    code,
    phase: 'eval',
    severity: 'error',
    message,
    hint,
    location: { line: node.line, col: node.col, span: node.span },
  });
}

function isLiteral(expr: Expr): boolean {
  switch (expr.kind) {
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'ArrayLiteral':
    case 'ObjectLiteral':
      return true;
    default:
      return false;
  }
}

function literalType(expr: Expr): TypeInfo {
  switch (expr.kind) {
    case 'StringLiteral':
      return { kind: 'string' };
    case 'NumberLiteral':
      return { kind: 'number' };
    case 'BooleanLiteral':
      return { kind: 'boolean' };
    case 'NullLiteral':
      return { kind: 'null' };
    case 'ArrayLiteral':
      return { kind: 'array', element: unknownType() };
    default:
      return { kind: 'object', properties: new Map() };
  }
}

function isScalarLiteral(expr: Expr): boolean {
  return isLiteral(expr) && expr.kind !== 'ObjectLiteral';
}

function isDefinitelyNonFunction(type: TypeInfo): boolean {
  switch (type.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'array':
    case 'object':
      return true;
    default:
      return false;
  }
}

function isJsonParseCall(expr: CallExpr): boolean {
  const callee = expr.callee;
  return (
    callee.kind === 'MemberExpr' &&
    callee.object.kind === 'Identifier' &&
    callee.object.name === 'json' &&
    callee.property === 'parse'
  );
}

function calleeName(callee: Expr): string | null {
  if (callee.kind === 'Identifier') return callee.name;
  if (callee.kind === 'MemberExpr' && callee.object.kind === 'Identifier') {
    return `${callee.object.name}.${callee.property}`;
  }
  return null;
}

export function checkProgram(program: Program, binder: BinderResult): PlacitumError[] {
  const context: CheckContext = {
    occurrences: new Map(binder.occurrences.map((occurrence) => [occurrence.span[0], occurrence])),
    bindings: new Map(binder.bindings.map((binding) => [binding.id, binding])),
  };
  const resolver: TypeResolver = (_name, node): TypeInfo | undefined => {
    const occurrence = context.occurrences.get(node.span[0]);
    if (occurrence === undefined) return undefined;
    return context.bindings.get(occurrence.binding)?.type;
  };
  const errors: PlacitumError[] = [];
  for (const statement of program.body) checkStmt(statement, context, resolver, errors);
  return errors;
}

function bindingOf(identifier: Identifier, context: CheckContext): Binding | undefined {
  const occurrence = context.occurrences.get(identifier.span[0]);
  return occurrence === undefined ? undefined : context.bindings.get(occurrence.binding);
}

function checkArity(errors: PlacitumError[], node: Located, label: string, expected: number, got: number, hint: string): void {
  if (expected === got) return;
  report(errors, 'E503_EVAL_ARITY_MISMATCH', node, `${label} expects ${expected} argument(s), got ${got}.`, hint);
}

function checkCallable(callee: Expr, node: Located, got: number, context: CheckContext, errors: PlacitumError[]): void {
  if (isLiteral(callee)) {
    const type = literalType(callee);
    report(errors, 'E502_EVAL_NOT_CALLABLE', node, `value of type ${typeNameOf(type)} is not callable.`, 'Only functions and closures can be called.');
    return;
  }
  if (callee.kind === 'Identifier') {
    const binding = bindingOf(callee, context);
    if (binding === undefined) return;
    if (isDefinitelyNonFunction(binding.type)) {
      report(errors, 'E502_EVAL_NOT_CALLABLE', node, `value of type ${typeNameOf(binding.type)} is not callable.`, 'Only functions and closures can be called.');
      return;
    }
    const count = functionParamCount(binding.type);
    if (count !== null) {
      const label = functionName(binding.type) ?? binding.name;
      checkArity(errors, node, `fn \`${label}\``, count, got, 'Match the FnDecl parameter list.');
    }
    return;
  }
  if (callee.kind === 'MemberExpr') {
    const signature = signatureOf(callee);
    if (signature !== null) {
      checkArity(errors, node, calleeName(callee) ?? 'function', signature.params.length, got, 'Match the function signature.');
    }
  }
}

function checkBangCall(expr: BangCall, got: number, errors: PlacitumError[]): void {
  if (!Object.hasOwn(BANG_SIGNATURES, expr.target)) return;
  const signature = BANG_SIGNATURES[expr.target];
  if (signature === undefined) return;
  checkArity(errors, expr, expr.target, signature.params.length, got, 'Match the function signature.');
}

function checkBinary(expr: BinaryExpr, resolver: TypeResolver, errors: PlacitumError[]): void {
  const operator = expr.operator;
  const left = inferType(expr.left, resolver);
  const right = inferType(expr.right, resolver);
  if (operator === '+') {
    if (isLiteral(expr.left) && isLiteral(expr.right)) {
      const valid = (left.kind === 'string' && right.kind === 'string') || (left.kind === 'number' && right.kind === 'number');
      if (!valid) {
        report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `operator "+" cannot combine ${typeNameOf(left)} and ${typeNameOf(right)}.`, 'Both operands must be numbers, or both strings.');
      }
    }
    return;
  }
  if (operator === '-' || operator === '*' || operator === '/') {
    const badLeft = isLiteral(expr.left) && left.kind !== 'number';
    const badRight = isLiteral(expr.right) && right.kind !== 'number';
    if (badLeft || badRight) {
      report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `operator "${operator}" requires numbers, got ${typeNameOf(left)} and ${typeNameOf(right)}.`, 'Both operands must be numbers.');
      return;
    }
    if (operator === '/' && expr.right.kind === 'NumberLiteral' && expr.right.value === 0) {
      report(errors, 'E504_EVAL_DIVISION_BY_ZERO', expr, 'division by zero.', 'Guard the divisor before dividing.');
    }
    return;
  }
  if (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') {
    const badLeft = isLiteral(expr.left) && left.kind !== 'number';
    const badRight = isLiteral(expr.right) && right.kind !== 'number';
    if (badLeft || badRight) {
      report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `operator "${operator}" compares numbers only, got ${typeNameOf(left)} and ${typeNameOf(right)}.`, 'Both operands must be numbers.');
    }
  }
}

function checkUnary(expr: UnaryExpr, resolver: TypeResolver, errors: PlacitumError[]): void {
  if (expr.operator !== '-') return;
  if (!isLiteral(expr.argument)) return;
  const type = inferType(expr.argument, resolver);
  if (type.kind === 'number') return;
  report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `unary "-" requires a number, got ${typeNameOf(type)}.`, 'Negate a number.');
}

function checkMember(expr: MemberExpr, errors: PlacitumError[]): void {
  if (!isScalarLiteral(expr.object)) return;
  const type = literalType(expr.object);
  report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `cannot read member "${expr.property}" of ${typeNameOf(type)}.`, 'Only objects have members.');
}

function checkCall(expr: CallExpr, piped: boolean, context: CheckContext, resolver: TypeResolver, errors: PlacitumError[]): void {
  checkCallable(expr.callee, expr, expr.args.length + (piped ? 1 : 0), context, errors);
  if (isJsonParseCall(expr) && expr.args.length === 1) {
    const argument = expr.args[0];
    if (argument !== undefined && isLiteral(argument)) {
      const type = literalType(argument);
      if (type.kind !== 'string') {
        report(errors, 'E501_EVAL_TYPE_MISMATCH', expr, `json.parse input must be a string, got ${typeNameOf(type)}.`, 'Pass a string value.');
      }
    }
  }
  checkExpr(expr.callee, false, context, resolver, errors);
  for (const argument of expr.args) checkExpr(argument, false, context, resolver, errors);
}

function checkExpr(expr: Expr, piped: boolean, context: CheckContext, resolver: TypeResolver, errors: PlacitumError[]): void {
  switch (expr.kind) {
    case 'CallExpr':
      checkCall(expr, piped, context, resolver, errors);
      return;
    case 'BangCall':
      checkBangCall(expr, expr.args.length + (piped ? 1 : 0), errors);
      for (const argument of expr.args) checkExpr(argument, false, context, resolver, errors);
      return;
    case 'Identifier':
      if (piped) checkCallable(expr, expr, 1, context, errors);
      return;
    case 'MemberExpr':
      if (piped) checkCallable(expr, expr, 1, context, errors);
      checkMember(expr, errors);
      checkExpr(expr.object, false, context, resolver, errors);
      return;
    case 'PipeExpr':
      expr.stages.forEach((stage, index) => checkExpr(stage, index > 0, context, resolver, errors));
      return;
    case 'BinaryExpr':
      checkBinary(expr, resolver, errors);
      checkExpr(expr.left, false, context, resolver, errors);
      checkExpr(expr.right, false, context, resolver, errors);
      return;
    case 'UnaryExpr':
      checkUnary(expr, resolver, errors);
      checkExpr(expr.argument, false, context, resolver, errors);
      return;
    case 'FStringExpr':
      for (const part of expr.parts) {
        if (typeof part !== 'string') checkExpr(part, false, context, resolver, errors);
      }
      return;
    case 'ArrayLiteral':
      if (piped) checkCallable(expr, expr, 1, context, errors);
      for (const element of expr.elements) checkExpr(element, false, context, resolver, errors);
      return;
    case 'ObjectLiteral':
      if (piped) checkCallable(expr, expr, 1, context, errors);
      for (const property of expr.properties) checkExpr(property.value, false, context, resolver, errors);
      return;
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return;
    case 'AssignExpr':
      checkExpr(expr.value, false, context, resolver, errors);
      return;
  }
}

function checkStmt(statement: Statement, context: CheckContext, resolver: TypeResolver, errors: PlacitumError[]): void {
  switch (statement.kind) {
    case 'LetStmt':
      checkExpr(statement.init, false, context, resolver, errors);
      return;
    case 'FnDecl':
      for (const nested of statement.body.body) checkStmt(nested, context, resolver, errors);
      return;
    case 'IfStmt':
      checkExpr(statement.test, false, context, resolver, errors);
      for (const nested of statement.consequent.body) checkStmt(nested, context, resolver, errors);
      if (statement.alternate !== null) {
        if (statement.alternate.kind === 'IfStmt') checkStmt(statement.alternate, context, resolver, errors);
        else for (const nested of statement.alternate.body) checkStmt(nested, context, resolver, errors);
      }
      return;
    case 'WhileStmt':
      checkExpr(statement.test, false, context, resolver, errors);
      for (const nested of statement.body.body) checkStmt(nested, context, resolver, errors);
      return;
    case 'ForStmt':
      checkExpr(statement.iterable, false, context, resolver, errors);
      if (isLiteral(statement.iterable) && literalType(statement.iterable).kind !== 'array') {
        report(errors, 'E501_EVAL_TYPE_MISMATCH', statement, `for-loop iterable must be an array, got ${typeNameOf(literalType(statement.iterable))}.`, 'Iterate an array value.');
      }
      for (const nested of statement.body.body) checkStmt(nested, context, resolver, errors);
      return;
    case 'ReturnStmt':
      if (statement.argument !== null) checkExpr(statement.argument, false, context, resolver, errors);
      return;
    case 'ExprStmt':
      checkExpr(statement.expression, false, context, resolver, errors);
      return;
    case 'NeedsDecl':
      return;
  }
}
