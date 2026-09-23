/**
 * Lexical scopes, bindings, occurrences and binding types.
 * Mirrors the core evaluator's scope model exactly (directive §2.5/§6.3):
 * declarations are visible to the whole scope (closures resolve at call time),
 * except a `let`'s own name, which is not visible in its initializer.
 */
import type { Expr, FnDecl, ForStmt, Identifier, LetStmt, Param, Program, Statement } from './core-adapter.js';
import { JSON_NAMESPACE_TYPE, inferType, unknownType, type TypeInfo } from './types.js';

export type ScopeKind = 'program' | 'fn' | 'block' | 'for-loop';
export type BindingKind = 'let' | 'fn' | 'param' | 'iterator' | 'builtin';

export interface Binding {
  id: number;
  name: string;
  kind: BindingKind;
  scope: number;
  declSpan: [number, number];
  nameSpan: [number, number];
  node: LetStmt | FnDecl | Param | ForStmt | null;
  type: TypeInfo;
}

export interface Scope {
  id: number;
  kind: ScopeKind;
  parent: number | null;
  span: [number, number];
  bindings: Map<string, Binding>;
  declarations: Binding[];
}

export interface Occurrence {
  span: [number, number];
  binding: number;
  mode: 'read' | 'write';
}

export interface BinderDiagnostic {
  code: 'E500_EVAL_UNBOUND_VAR' | 'E506_EVAL_REDECLARATION';
  span: [number, number];
  message: string;
  hint: string;
}

export interface BinderResult {
  scopes: Scope[];
  bindings: Binding[];
  occurrences: Occurrence[];
  diagnostics: BinderDiagnostic[];
}

function tuple(span: readonly [number, number]): [number, number] {
  return [span[0], span[1]];
}

function elementTypeOf(type: TypeInfo): TypeInfo {
  return type.kind === 'array' ? type.element : unknownType();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Locate a declared name: word-bounded first match at or after `offset`. */
export function nameSpanIn(source: string, offset: number, name: string): [number, number] {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  const match = pattern.exec(source.slice(offset));
  if (match === null) return [offset, offset];
  const start = offset + match.index;
  return [start, start + name.length];
}

class Binder {
  private readonly scopes: Scope[] = [];
  private readonly bindings: Binding[] = [];
  private readonly occurrences: Occurrence[] = [];
  private readonly diagnostics: BinderDiagnostic[] = [];
  private readonly declared = new Map<Statement, Binding>();
  private nextId = 0;

  constructor(private readonly source: string) {}

  run(program: Program): BinderResult {
    const programScope = this.createScope('program', null, program.span);
    this.define(programScope, 'json', 'builtin', [0, 0], [0, 0], null, JSON_NAMESPACE_TYPE);
    this.walkScope(program.body, programScope);
    return {
      scopes: this.scopes,
      bindings: this.bindings,
      occurrences: this.occurrences,
      diagnostics: this.diagnostics,
    };
  }

  private createScope(kind: ScopeKind, parent: Scope | null, span: readonly [number, number]): Scope {
    const scope: Scope = {
      id: this.scopes.length,
      kind,
      parent: parent === null ? null : parent.id,
      span: tuple(span),
      bindings: new Map(),
      declarations: [],
    };
    this.scopes.push(scope);
    return scope;
  }

  private define(
    scope: Scope,
    name: string,
    kind: BindingKind,
    declSpan: readonly [number, number],
    nameSpan: readonly [number, number],
    node: LetStmt | FnDecl | Param | ForStmt | null,
    type: TypeInfo,
  ): Binding {
    const binding: Binding = {
      id: this.nextId++,
      name,
      kind,
      scope: scope.id,
      declSpan: tuple(declSpan),
      nameSpan: tuple(nameSpan),
      node,
      type,
    };
    scope.bindings.set(name, binding);
    scope.declarations.push(binding);
    this.bindings.push(binding);
    return binding;
  }

  /** Locate the declared name inside a declaration: word-bounded first match after the keyword. */
  private nameSpanAfter(offset: number, name: string): [number, number] {
    return nameSpanIn(this.source, offset, name);
  }

  private walkScope(statements: Statement[], scope: Scope): void {
    this.predeclare(statements, scope);
    for (const statement of statements) this.walkStmt(statement, scope);
  }

  /** All direct let/fn declarations are visible in their scope before its statements run. */
  private predeclare(statements: Statement[], scope: Scope): void {
    for (const statement of statements) {
      if (statement.kind === 'LetStmt') {
        if (scope.bindings.has(statement.id)) {
          this.redeclaration('let', statement.id, statement.span);
          continue;
        }
        this.declared.set(
          statement,
          this.define(scope, statement.id, 'let', statement.span, this.nameSpanAfter(statement.span[0], statement.id), statement, unknownType()),
        );
      } else if (statement.kind === 'FnDecl') {
        if (scope.bindings.has(statement.id)) {
          this.redeclaration('fn', statement.id, statement.span);
          continue;
        }
        this.declared.set(
          statement,
          this.define(
            scope,
            statement.id,
            'fn',
            statement.span,
            this.nameSpanAfter(statement.span[0], statement.id),
            statement,
            { kind: 'function', signature: { params: statement.params.map((param) => param.id), name: statement.id } },
          ),
        );
      }
    }
  }

  private walkStmt(statement: Statement, scope: Scope): void {
    switch (statement.kind) {
      case 'LetStmt': {
        const binding = this.declared.get(statement);
        this.walkExpr(statement.init, scope, binding);
        if (binding !== undefined) binding.type = inferType(statement.init, this.resolver(scope, binding));
        return;
      }
      case 'FnDecl': {
        const fnScope = this.createScope('fn', scope, statement.span);
        for (const param of statement.params) {
          if (!fnScope.bindings.has(param.id)) {
            this.define(fnScope, param.id, 'param', param.span, param.span, param, unknownType());
          }
        }
        this.walkScope(statement.body.body, fnScope);
        return;
      }
      case 'IfStmt': {
        this.walkExpr(statement.test, scope);
        const consequent = this.createScope('block', scope, statement.consequent.span);
        this.walkScope(statement.consequent.body, consequent);
        if (statement.alternate !== null) {
          if (statement.alternate.kind === 'IfStmt') {
            this.walkStmt(statement.alternate, scope);
          } else {
            const alternate = this.createScope('block', scope, statement.alternate.span);
            this.walkScope(statement.alternate.body, alternate);
          }
        }
        return;
      }
      case 'WhileStmt': {
        this.walkExpr(statement.test, scope);
        const body = this.createScope('block', scope, statement.body.span);
        this.walkScope(statement.body.body, body);
        return;
      }
      case 'ForStmt': {
        this.walkExpr(statement.iterable, scope);
        const loop = this.createScope('for-loop', scope, statement.span);
        this.define(
          loop,
          statement.iterator,
          'iterator',
          statement.span,
          this.nameSpanAfter(statement.span[0], statement.iterator),
          statement,
          elementTypeOf(inferType(statement.iterable, this.resolver(scope))),
        );
        const body = this.createScope('block', loop, statement.body.span);
        this.walkScope(statement.body.body, body);
        return;
      }
      case 'ReturnStmt':
        this.walkExpr(statement.argument, scope);
        return;
      case 'ExprStmt':
        this.walkExpr(statement.expression, scope);
        return;
      case 'NeedsDecl':
        return;
    }
  }

  private walkExpr(expr: Expr | null, scope: Scope, exclude?: Binding): void {
    if (expr === null) return;
    switch (expr.kind) {
      case 'Identifier': {
        const binding = this.resolve(expr.name, scope, exclude);
        if (binding === undefined) this.unboundRead(expr.name, expr.span);
        else this.occurrences.push({ span: tuple(expr.span), binding: binding.id, mode: 'read' });
        return;
      }
      case 'AssignExpr': {
        this.walkExpr(expr.value, scope, exclude);
        const binding = this.resolve(expr.id, scope);
        if (binding === undefined) this.unboundAssign(expr.id, expr.span);
        else this.occurrences.push({ span: this.nameSpanAfter(expr.span[0], expr.id), binding: binding.id, mode: 'write' });
        return;
      }
      case 'BangCall': {
        this.walkBangTarget(expr, scope);
        for (const arg of expr.args) this.walkExpr(arg, scope, exclude);
        return;
      }
      case 'CallExpr':
        this.walkExpr(expr.callee, scope, exclude);
        for (const arg of expr.args) this.walkExpr(arg, scope, exclude);
        return;
      case 'PipeExpr':
        for (const stage of expr.stages) this.walkExpr(stage, scope, exclude);
        return;
      case 'MemberExpr':
        this.walkExpr(expr.object, scope, exclude);
        return;
      case 'FStringExpr':
        for (const part of expr.parts) {
          if (typeof part !== 'string') this.walkExpr(part, scope, exclude);
        }
        return;
      case 'ArrayLiteral':
        for (const element of expr.elements) this.walkExpr(element, scope, exclude);
        return;
      case 'ObjectLiteral':
        for (const property of expr.properties) this.walkExpr(property.value, scope, exclude);
        return;
      case 'BinaryExpr':
        this.walkExpr(expr.left, scope, exclude);
        this.walkExpr(expr.right, scope, exclude);
        return;
      case 'UnaryExpr':
        this.walkExpr(expr.argument, scope, exclude);
        return;
      case 'StringLiteral':
      case 'NumberLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
        return;
    }
  }

  /**
   * A bang target is a raw dotted string, not an identifier. Resolve/show the
   * first segment only when a user binding shadows a stdlib name; effectful
   * names are never bound, so unresolved targets are never E500.
   */
  private walkBangTarget(expr: { target: string; span: readonly [number, number] }, scope: Scope): void {
    const first = expr.target.split('.')[0];
    if (first === undefined || first.length === 0) return;
    const binding = this.resolve(first, scope);
    if (binding === undefined) return;
    this.occurrences.push({ span: [expr.span[0], expr.span[0] + first.length], binding: binding.id, mode: 'read' });
  }

  private resolve(name: string, scope: Scope, exclude?: Binding): Binding | undefined {
    let current: Scope | undefined = scope;
    while (current !== undefined) {
      const binding = current.bindings.get(name);
      if (binding !== undefined && binding !== exclude) return binding;
      current = current.parent === null ? undefined : this.scopes[current.parent];
    }
    return undefined;
  }

  private resolver(scope: Scope, exclude?: Binding): (name: string) => TypeInfo | undefined {
    return (name) => this.resolve(name, scope, exclude)?.type;
  }

  private unboundRead(name: string, span: readonly [number, number]): void {
    this.diagnostics.push({
      code: 'E500_EVAL_UNBOUND_VAR',
      span: tuple(span),
      message: `identifier \`${name}\` is not declared in any enclosing scope.`,
      hint: 'Declare it with `let` before use.',
    });
  }

  private unboundAssign(name: string, span: readonly [number, number]): void {
    this.diagnostics.push({
      code: 'E500_EVAL_UNBOUND_VAR',
      span: tuple(span),
      message: `assignment to \`${name}\` finds no declared binding in any enclosing scope.`,
      hint: '`=` only reassigns existing bindings; declare it with `let` first.',
    });
  }

  private redeclaration(kind: 'let' | 'fn', name: string, span: readonly [number, number]): void {
    this.diagnostics.push({
      code: 'E506_EVAL_REDECLARATION',
      span: tuple(span),
      message: `${kind} \`${name}\` is already declared in this scope.`,
      hint: 'Rename one binding; inner scopes may shadow, the same scope may not.',
    });
  }
}

export function bind(program: Program, source: string): BinderResult {
  return new Binder(source).run(program);
}

export interface BindingHit {
  binding: Binding;
  occurrence: Occurrence | null;
  /** Span of the identifier under the cursor (occurrence span or declaration name). */
  span: [number, number];
}

/** Resolve the binding/occurrence at a UTF-16 offset; declarations match by name span. */
export function bindingAt(result: BinderResult, offset: number): BindingHit | null {
  const byId = new Map(result.bindings.map((binding) => [binding.id, binding]));
  for (const occurrence of result.occurrences) {
    if (offset >= occurrence.span[0] && offset < occurrence.span[1]) {
      const binding = byId.get(occurrence.binding);
      if (binding !== undefined) return { binding, occurrence, span: [occurrence.span[0], occurrence.span[1]] };
    }
  }
  for (const binding of result.bindings) {
    if (offset >= binding.nameSpan[0] && offset < binding.nameSpan[1]) {
      return { binding, occurrence: null, span: [binding.nameSpan[0], binding.nameSpan[1]] };
    }
  }
  return null;
}

/** Innermost scope containing the offset. */
export function scopeAt(result: BinderResult, offset: number): Scope | undefined {
  let best: Scope | undefined;
  for (const scope of result.scopes) {
    if (offset < scope.span[0] || offset >= scope.span[1]) continue;
    if (best === undefined || scope.span[1] - scope.span[0] < best.span[1] - best.span[0]) best = scope;
  }
  return best;
}

/** Bindings visible at an offset; the nearest declaration per name wins. */
export function visibleBindings(result: BinderResult, offset: number): Binding[] {
  const byName = new Map<string, Binding>();
  let current = scopeAt(result, offset);
  while (current !== undefined) {
    for (const binding of current.declarations) {
      if (!byName.has(binding.name)) byName.set(binding.name, binding);
    }
    current = current.parent === null ? undefined : result.scopes[current.parent];
  }
  return [...byName.values()];
}

/** Type resolver backed by the binder's occurrences (works for any AST node). */
export function typeResolver(result: BinderResult): (name: string, node: Identifier) => TypeInfo | undefined {
  const occurrences = new Map(result.occurrences.map((occurrence) => [occurrence.span[0], occurrence]));
  const bindings = new Map(result.bindings.map((binding) => [binding.id, binding]));
  return (_name, node) => {
    const occurrence = occurrences.get(node.span[0]);
    return occurrence === undefined ? undefined : bindings.get(occurrence.binding)?.type;
  };
}

export function isWritten(result: BinderResult, bindingId: number): boolean {
  return result.occurrences.some((occurrence) => occurrence.binding === bindingId && occurrence.mode === 'write');
}
