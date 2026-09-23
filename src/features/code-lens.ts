/** Code lens over needs clauses and attenuated fns (directive §7.11); pure. */
import type { CodeLens } from 'vscode-languageserver/node.js';
import { manifestTokenTexts } from '../analysis/capabilities.js';
import type { FnDecl, Program } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';

const SUMMARY_LIMIT = 60;

function lensAt(analysis: Analysis, offset: number, title: string): CodeLens {
  return {
    range: spanToRange(analysis.document, [offset, offset]),
    command: { title, command: 'placitum.showManifest', arguments: [analysis.uri] },
  };
}

/** Manifest counts, falling back to AST tokens when extraction failed (E301/E303). */
function needsSummary(analysis: Analysis, program: Program): string {
  const manifest = analysis.capabilities?.manifest ?? null;
  const grants = manifest === null
    ? program.needs.reduce((total, needs) => total + needs.tokens.length, 0)
    : manifestTokenTexts(manifest).length;
  const deferred = manifest?.deferredToRuntime.length ?? 0;
  const label = grants === 0 ? 'no grants' : `${grants} grant${grants === 1 ? '' : 's'}`;
  return `${label} · ${deferred} deferred — show manifest`;
}

function fnLens(analysis: Analysis, fn: FnDecl): CodeLens | null {
  if (fn.needs === null) return null;
  const source = analysis.document.getText();
  const raw = fn.needs.tokens.map((token) => source.slice(token.span[0], token.span[1])).join(', ');
  const summary = raw.length > SUMMARY_LIMIT ? `${raw.slice(0, SUMMARY_LIMIT - 3)}...` : raw;
  return lensAt(analysis, fn.span[0], `needs ${summary}`);
}

/** One lens per top-level needs decl and per fn carrying a needs clause. */
export function codeLenses(analysis: Analysis): CodeLens[] {
  const program = analysis.core.program;
  if (program === null || analysis.core.diagnostics.some((diagnostic) => diagnostic.phase === 'parse')) return [];
  const lenses: CodeLens[] = [];
  const summary = needsSummary(analysis, program);
  for (const needs of program.needs) lenses.push(lensAt(analysis, needs.span[0], summary));
  for (const fn of analysis.capabilities?.fns ?? []) {
    const lens = fnLens(analysis, fn);
    if (lens !== null) lenses.push(lens);
  }
  return lenses;
}
