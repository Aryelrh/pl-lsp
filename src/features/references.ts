/** Single-file references for the binding under the cursor; pure. */
import { bindingAt } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';
import type { Location } from 'vscode-languageserver/node.js';

function locationOf(analysis: Analysis, span: readonly [number, number]): Location {
  return { uri: analysis.uri, range: spanToRange(analysis.document, span) };
}

export function referencesAt(analysis: Analysis, offset: number, includeDeclaration: boolean): Location[] {
  const binder = analysis.binder;
  if (binder === null) return [];
  const hit = bindingAt(binder, offset);
  if (hit === null || hit.binding.kind === 'builtin') return [];
  const locations: Location[] = [];
  for (const occurrence of binder.occurrences) {
    if (occurrence.binding === hit.binding.id) locations.push(locationOf(analysis, occurrence.span));
  }
  if (includeDeclaration) locations.push(locationOf(analysis, hit.binding.nameSpan));
  locations.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  return locations;
}
