/** Document highlights: occurrences of the binding under the cursor (directive §7.9). */
import { DocumentHighlightKind, type DocumentHighlight } from 'vscode-languageserver/node.js';
import { bindingAt } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';

export function highlightsAt(analysis: Analysis, offset: number): DocumentHighlight[] {
  const binder = analysis.binder;
  if (binder === null) return [];
  const hit = bindingAt(binder, offset);
  if (hit === null || hit.binding.kind === 'builtin') return [];
  return binder.occurrences
    .filter((occurrence) => occurrence.binding === hit.binding.id)
    .map((occurrence) => ({
      range: spanToRange(analysis.document, occurrence.span),
      kind: occurrence.mode === 'write' ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
    }));
}
