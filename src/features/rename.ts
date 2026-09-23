/** Scope-aware rename: binder occurrences only, never textual; pure. */
import { ErrorCodes, ResponseError, type Range, type TextEdit, type WorkspaceEdit } from 'vscode-languageserver/node.js';
import { bindingAt, type BindingHit } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYWORDS = new Set(['needs', 'let', 'fn', 'if', 'else', 'while', 'for', 'in', 'return', 'not', 'only', 'true', 'false', 'null']);

function renameError(message: string): ResponseError {
  return new ResponseError(ErrorCodes.InvalidParams, message);
}

function renamable(analysis: Analysis, offset: number): BindingHit {
  const binder = analysis.binder;
  if (binder === null) throw renameError('The document is not fully parsed, nothing can be renamed yet.');
  const hit = bindingAt(binder, offset);
  if (hit === null) {
    throw renameError('No renamable binding under the cursor (keywords, capability tokens and effectful names cannot be renamed).');
  }
  if (hit.binding.kind === 'builtin') throw renameError('The builtin `json` cannot be renamed.');
  return hit;
}

function rangeOf(analysis: Analysis, span: readonly [number, number]): Range {
  return spanToRange(analysis.document, span);
}

export function prepareRenameAt(analysis: Analysis, offset: number): { range: Range; placeholder: string } {
  const hit = renamable(analysis, offset);
  return { range: rangeOf(analysis, hit.span), placeholder: hit.binding.name };
}

export function renameAt(analysis: Analysis, offset: number, newName: string): WorkspaceEdit | null {
  const hit = renamable(analysis, offset);
  if (hit.binding.name === newName) return null;
  if (!IDENTIFIER_PATTERN.test(newName)) throw renameError(`"${newName}" is not a valid Placitum identifier.`);
  if (KEYWORDS.has(newName)) throw renameError(`"${newName}" is a reserved keyword.`);
  const scope = analysis.binder?.scopes[hit.binding.scope];
  if (scope?.bindings.has(newName) === true) {
    throw renameError(`Renaming to "${newName}" would redeclare a binding in this scope (E506).`);
  }
  const edits: TextEdit[] = [{ range: rangeOf(analysis, hit.binding.nameSpan), newText: newName }];
  for (const occurrence of analysis.binder?.occurrences ?? []) {
    if (occurrence.binding === hit.binding.id) edits.push({ range: rangeOf(analysis, occurrence.span), newText: newName });
  }
  edits.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return { changes: { [analysis.uri]: edits } };
}
