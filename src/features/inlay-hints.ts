/** Inlay hints: inferred `let` types and bang coverage (directive §7.11); pure. */
import { InlayHintKind, type InlayHint, type Range } from 'vscode-languageserver/node.js';
import { coverageGrants, describeBang, effectiveManifestAt, grantTokenText } from '../analysis/capabilities.js';
import type { BangCall } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';
import { describeType } from '../analysis/types.js';
import { collectNodes } from '../analysis/walk.js';

export interface InlayHintOptions {
  /** `placitum.inlayHints.capabilities`: show `needs ...` after covered bang calls. */
  capabilities: boolean;
}

function within(analysis: Analysis, offset: number, range: Range): boolean {
  const start = analysis.document.offsetAt(range.start);
  const end = analysis.document.offsetAt(range.end);
  return offset >= start && offset <= end;
}

function typeHints(analysis: Analysis, range: Range): InlayHint[] {
  const binder = analysis.binder;
  if (binder === null) return [];
  const hints: InlayHint[] = [];
  for (const binding of binder.bindings) {
    if (binding.kind !== 'let') continue;
    if (binding.type.kind === 'unknown' || binding.type.kind === 'null') continue;
    if (!within(analysis, binding.nameSpan[1], range)) continue;
    hints.push({
      position: analysis.document.positionAt(binding.nameSpan[1]),
      label: `: ${describeType(binding.type)}`,
      kind: InlayHintKind.Type,
      paddingLeft: false,
    });
  }
  return hints;
}

function capabilityHints(analysis: Analysis, range: Range): InlayHint[] {
  const program = analysis.core.program;
  const model = analysis.capabilities;
  if (program === null || model === null) return [];
  const hints: InlayHint[] = [];
  for (const bang of collectNodes<BangCall>(program.body, 'BangCall')) {
    const info = describeBang(model, bang);
    const category = info.category;
    if (info.status !== 'statically-covered' || category === null) continue;
    if (!within(analysis, bang.span[1], range)) continue;
    const manifest = effectiveManifestAt(model, bang.span[0]);
    const grants = manifest === null ? [] : coverageGrants(manifest, category);
    const label = grants.length === 0 ? 'needs (covered)' : `needs ${grants.map((grant) => grantTokenText(category, grant)).join(', ')}`;
    hints.push({
      position: analysis.document.positionAt(bang.span[1]),
      label,
      kind: InlayHintKind.Type,
      paddingLeft: true,
    });
  }
  return hints;
}

export function inlayHints(analysis: Analysis, range: Range, options: InlayHintOptions): InlayHint[] {
  const hints = typeHints(analysis, range);
  if (options.capabilities) hints.push(...capabilityHints(analysis, range));
  hints.sort((a, b) => a.position.line - b.position.line || a.position.character - b.position.character);
  return hints;
}
