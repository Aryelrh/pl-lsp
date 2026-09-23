/** Go-to-definition and go-to-type-definition resolution; pure, no connection. */
import type { MemberExpr } from '../analysis/core-adapter.js';
import { bindingAt, nameSpanIn } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';
import type { Range } from 'vscode-languageserver/node.js';

export interface DefinitionTarget {
  uri: string;
  /** Whole declaration node. */
  range: Range;
  /** Identifier itself. */
  selectionRange: Range;
  /** Token under the cursor. */
  origin: Range;
}

function rangeOf(analysis: Analysis, span: readonly [number, number]): Range {
  return spanToRange(analysis.document, span);
}

function targetOf(
  analysis: Analysis,
  declarationSpan: readonly [number, number],
  nameSpan: readonly [number, number],
  originSpan: readonly [number, number],
): DefinitionTarget {
  return {
    uri: analysis.uri,
    range: rangeOf(analysis, declarationSpan),
    selectionRange: rangeOf(analysis, nameSpan),
    origin: rangeOf(analysis, originSpan),
  };
}

function collectMembers(value: unknown, out: MemberExpr[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMembers(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if ((value as { kind?: unknown }).kind === 'MemberExpr') out.push(value as MemberExpr);
    for (const item of Object.values(value)) collectMembers(item, out);
  }
}

/**
 * Definition of an object property whose receiver is a binding initialized
 * with an object literal. ponytail: direct literal initializers only; chained
 * or computed shapes need property origins tracked in TypeInfo.
 */
function objectPropertyTarget(analysis: Analysis, offset: number): DefinitionTarget | null {
  const binder = analysis.binder;
  const program = analysis.core.program;
  if (binder === null || program === null) return null;
  const source = analysis.document.getText();
  const members: MemberExpr[] = [];
  collectMembers(program.body, members);
  for (const member of members) {
    const propertyStart = member.span[1] - member.property.length;
    if (offset < propertyStart || offset >= member.span[1]) continue;
    const object = member.object;
    if (object.kind !== 'Identifier') return null;
    const hit = bindingAt(binder, object.span[0]);
    const node = hit?.binding.node;
    if (node === null || node === undefined || node.kind !== 'LetStmt' || node.init.kind !== 'ObjectLiteral') return null;
    const property = node.init.properties.find((candidate) => candidate.key === member.property);
    if (property === undefined) return null;
    return targetOf(analysis, property.span, nameSpanIn(source, property.span[0], property.key), [
      propertyStart,
      member.span[1],
    ]);
  }
  return null;
}

function bindingTarget(analysis: Analysis, offset: number): DefinitionTarget | null {
  const binder = analysis.binder;
  if (binder === null) return null;
  const hit = bindingAt(binder, offset);
  if (hit === null) return null;
  // Builtins (`json`) and stdlib names have no user declaration; hover explains them.
  if (hit.binding.kind === 'builtin') return null;
  return targetOf(analysis, hit.binding.declSpan, hit.binding.nameSpan, hit.span);
}

export function definitionAt(analysis: Analysis, offset: number): DefinitionTarget | null {
  return bindingTarget(analysis, offset) ?? objectPropertyTarget(analysis, offset);
}

export function typeDefinitionAt(analysis: Analysis, offset: number): DefinitionTarget | null {
  return bindingTarget(analysis, offset);
}
