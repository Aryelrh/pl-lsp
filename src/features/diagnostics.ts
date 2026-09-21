/** Maps core diagnostics to LSP diagnostics (range, severity, code, message, data). Pure. */
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver/node.js';
import type { Analysis } from '../analysis/model.js';
import type { PlacitumError } from '../analysis/core-adapter.js';
import { errorRange } from '../analysis/positions.js';
import type { PlacitumConfig } from '../config.js';

function toDiagnostic(analysis: Analysis, error: PlacitumError): Diagnostic {
  return {
    range: errorRange(analysis.document, error),
    severity: DiagnosticSeverity.Error,
    code: error.code,
    source: 'placitum',
    message: error.hint !== undefined ? `${error.message}\n\nhint: ${error.hint}` : error.message,
    data: error.hint !== undefined ? { phase: error.phase, hint: error.hint } : { phase: error.phase },
  };
}

export function computeDiagnostics(analysis: Analysis, config: PlacitumConfig): Diagnostic[] {
  if (!config.diagnostics.enable) return [];
  return analysis.core.diagnostics.map((error) => toDiagnostic(analysis, error));
}
