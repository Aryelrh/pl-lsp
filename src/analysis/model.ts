/** Analysis: everything derived from one document version; cached by documents.ts. */
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { analyze, type AnalysisResult } from './core-adapter.js';

export interface Analysis {
  readonly uri: string;
  readonly version: number;
  readonly document: TextDocument;
  readonly core: AnalysisResult;
}

export function createAnalysis(document: TextDocument): Analysis {
  return {
    uri: document.uri,
    version: document.version,
    document,
    core: analyze(document.getText()),
  };
}
