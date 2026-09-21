/**
 * The only module allowed to import `placitum`; freezes the core API surface
 * so a future core version only ever changes this file.
 */
import { analyzeSource } from 'placitum';
import type { AnalysisResult, CommentTrivia, PlacitumError } from 'placitum';

/** Commit SHA of quesadx/pl-lg pinned in package.json (see docs/CORE-VERSION.md). */
export const CORE_API_VERSION = 'dd1f362b35888d8a19b2215772db2389e8bb244a';

/** Pure pipeline: lex -> parse -> extract, tolerant, no execution. */
export function analyze(source: string): AnalysisResult {
  return analyzeSource(source);
}

export type { AnalysisResult, CommentTrivia, PlacitumError };
