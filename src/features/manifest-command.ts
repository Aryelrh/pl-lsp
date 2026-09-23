/**
 * `placitum/manifest` payload and command text (directive §7.11).
 * The markdown is the core renderer's output, never a re-implementation.
 */
import { explainManifest, type PlacitumError, type SerializedManifest } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';

export interface ManifestPayload {
  markdown: string;
  manifest: SerializedManifest | null;
  diagnostics: PlacitumError[];
}

/** `window/showMessage` cap; the full text always goes to the server log. */
export const MESSAGE_CAP = 10 * 1024;

function describeDiagnostic(error: PlacitumError): string {
  const where = error.location === undefined ? '' : ` (${error.location.line}:${error.location.col})`;
  return `- \`${error.code}\`${where}: ${error.message}`;
}

export function manifestPayload(analysis: Analysis): ManifestPayload {
  const diagnostics: PlacitumError[] = [
    ...analysis.core.diagnostics,
    ...analysis.strictChecks,
    ...analysis.staticChecks,
  ];
  const manifest = analysis.capabilities?.manifest ?? null;
  if (manifest !== null) return { markdown: explainManifest(manifest), manifest, diagnostics };
  const syntax = analysis.core.diagnostics.some(
    (diagnostic) => diagnostic.phase === 'lex' || diagnostic.phase === 'parse',
  );
  const lines = diagnostics.map(describeDiagnostic);
  lines.push(syntax ? 'Fix the syntax errors to see the manifest.' : 'Fix the capability errors to see the manifest.');
  return { markdown: lines.join('\n'), manifest: null, diagnostics };
}

/** Cap for `window/showMessage`; longer manifests point at the server log. */
export function capMessage(markdown: string): string {
  if (markdown.length <= MESSAGE_CAP) return markdown;
  return `${markdown.slice(0, MESSAGE_CAP)}\n… (truncated, see the server log)`;
}
