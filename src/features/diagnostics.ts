/** Maps core and analysis diagnostics to LSP diagnostics (range, severity, code, message, data). Pure. */
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver/node.js';
import type { BinderDiagnostic } from '../analysis/binder.js';
import type { PlacitumError } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';
import { errorRange } from '../analysis/positions.js';
import type { PlacitumConfig } from '../config.js';

function binderEnvelope(analysis: Analysis, diagnostic: BinderDiagnostic): PlacitumError {
  const start = analysis.document.positionAt(diagnostic.span[0]);
  return {
    code: diagnostic.code,
    phase: 'eval',
    severity: 'error',
    message: diagnostic.message,
    hint: diagnostic.hint,
    location: { line: start.line + 1, col: start.character + 1, span: diagnostic.span },
  };
}

/** Quick-fix tags for code actions (§7.2); the handler still recomputes the edit. */
const QUICK_FIX_TAGS: Record<string, string[]> = {
  E101_LEX_UNTERMINATED_STRING: ['insert-closing-quote'],
  E203_PARSE_UNTERMINATED_BLOCK: ['insert-closing-brace'],
  E301_EXTRACT_UNCOVERED_CAPABILITY: ['add-needs'],
  E500_EVAL_UNBOUND_VAR: ['declare-let'],
  E506_EVAL_REDECLARATION: ['rename-binding'],
};

function quickFixTags(error: PlacitumError): string[] {
  if (error.code === 'E104_LEX_UNEXPECTED_CHARACTER') {
    return error.message.startsWith('Whitespace is not allowed') ? ['remove-bang-whitespace'] : [];
  }
  return QUICK_FIX_TAGS[error.code] ?? [];
}

function dataFor(error: PlacitumError): Record<string, unknown> {
  const data: Record<string, unknown> = { phase: error.phase };
  if (error.hint !== undefined) data['hint'] = error.hint;
  const tags = quickFixTags(error);
  if (tags.length > 0) data['quickFixes'] = tags;
  return data;
}

function toDiagnostic(analysis: Analysis, error: PlacitumError): Diagnostic {
  return {
    range: errorRange(analysis.document, error),
    severity: DiagnosticSeverity.Error,
    code: error.code,
    source: 'placitum',
    message: error.hint !== undefined ? `${error.message}\n\nhint: ${error.hint}` : error.message,
    data: dataFor(error),
  };
}

function sourceOffset(error: PlacitumError): number {
  return error.location?.span?.[0] ?? Number.MAX_SAFE_INTEGER;
}

export function computeDiagnostics(analysis: Analysis, config: PlacitumConfig): Diagnostic[] {
  if (!config.diagnostics.enable) return [];
  const raw: PlacitumError[] = [...analysis.core.diagnostics];
  if (config.diagnostics.scope && analysis.binder !== null) {
    for (const diagnostic of analysis.binder.diagnostics) raw.push(binderEnvelope(analysis, diagnostic));
  }
  if (config.diagnostics.strictChecks) raw.push(...analysis.strictChecks);
  if (config.diagnostics.literalTypes) raw.push(...analysis.staticChecks);
  raw.sort((a, b) => sourceOffset(a) - sourceOffset(b));
  return raw.map((error) => toDiagnostic(analysis, error));
}
