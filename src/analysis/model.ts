/** Analysis: everything derived from one document version; cached by documents.ts. */
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, strictDiagnostics, type AnalysisResult, type CommentTrivia, type PlacitumError } from './core-adapter.js';
import { bind, type BinderResult } from './binder.js';
import { buildCapabilities, type CapabilityModel } from './capabilities.js';
import { checkProgram } from './checks.js';
import { collectComments } from './comments.js';

export interface Analysis {
  readonly uri: string;
  readonly version: number;
  readonly document: TextDocument;
  readonly core: AnalysisResult;
  readonly binder: BinderResult | null;
  readonly comments: CommentTrivia[];
  /** E501-E504, definitely-certain literal checks. */
  readonly staticChecks: PlacitumError[];
  /** E505, from the core strict collector; empty without `#!strict`. */
  readonly strictChecks: PlacitumError[];
  readonly capabilities: CapabilityModel | null;
}

export function createAnalysis(document: TextDocument): Analysis {
  const text = document.getText();
  const core = analyze(text);
  const program = core.program;
  let binder: BinderResult | null = null;
  let staticChecks: PlacitumError[] = [];
  let strictChecks: PlacitumError[] = [];
  let capabilities: CapabilityModel | null = null;
  // Recovered ASTs (any parse diagnostic) must not produce cascading E5xx errors.
  if (program !== null && !core.diagnostics.some((diagnostic) => diagnostic.phase === 'parse')) {
    binder = bind(program, text);
    staticChecks = checkProgram(program, binder);
    strictChecks = strictDiagnostics(program);
    capabilities = buildCapabilities(program, core.manifest);
  }
  return {
    uri: document.uri,
    version: document.version,
    document,
    core,
    binder,
    comments: collectComments(text, core.tokens, core.comments),
    staticChecks,
    strictChecks,
    capabilities,
  };
}
