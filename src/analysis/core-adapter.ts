/**
 * The only module allowed to import `placitum`; freezes the core API surface
 * so a future core version only ever changes this file.
 */
import {
  AMBIENT_BANGS,
  BANG_REGISTRY,
  BANG_SIGNATURES,
  EFFECTFUL_STDLIB,
  PURE_SIGNATURES,
  analyzeSource,
  calleeSignature,
  collectStrictDiagnostics,
  explain,
  globCovers,
  hostToRegex,
} from 'placitum';
import type { AnalysisResult, Expr, NativeSig, PlacitumError, Program, SerializedManifest } from 'placitum';

/** Version of the `placitum` core this adapter is written against (see docs/CORE-VERSION.md). */
export const CORE_API_VERSION = '1.0.0';

/** Pure pipeline: lex -> parse -> extract, tolerant, no execution. */
export function analyze(source: string): AnalysisResult {
  return analyzeSource(source);
}

/** E505 collector, envelope form; the LSP never sees core error classes. */
export function strictDiagnostics(program: Program): PlacitumError[] {
  return collectStrictDiagnostics(program).map((error) => error.toEnvelope());
}

export function signatureOf(callee: Expr): NativeSig | null {
  return calleeSignature(callee);
}

/** Core's manifest renderer, verbatim: `placitum explain` output byte for byte. */
export function explainManifest(manifest: SerializedManifest): string {
  return explain(manifest);
}

export { AMBIENT_BANGS, BANG_REGISTRY, BANG_SIGNATURES, EFFECTFUL_STDLIB, PURE_SIGNATURES, globCovers, hostToRegex };
export type * from 'placitum';
export type { AnalysisResult, Expr, NativeSig, PlacitumError, Program };
