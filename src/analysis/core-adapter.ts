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
  globCovers,
  hostToRegex,
} from 'placitum';
import type { AnalysisResult, Expr, NativeSig, PlacitumError, Program } from 'placitum';

/** Commit SHA of quesadx/pl-lg pinned in package.json (see docs/CORE-VERSION.md). */
export const CORE_API_VERSION = 'dd1f362b35888d8a19b2215772db2389e8bb244a';

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

export { AMBIENT_BANGS, BANG_REGISTRY, BANG_SIGNATURES, EFFECTFUL_STDLIB, PURE_SIGNATURES, globCovers, hostToRegex };
export type * from 'placitum';
export type { AnalysisResult, Expr, NativeSig, PlacitumError, Program };
