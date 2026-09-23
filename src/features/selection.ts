/** Selection ranges: AST ancestor chain, with token/line fallbacks (directive §7.9). */
import type { Position, SelectionRange } from 'vscode-languageserver/node.js';
import type { Program, Token } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';
import { spanToRange } from '../analysis/positions.js';

interface Spanned {
  span: readonly [number, number];
}

function collectContaining(value: unknown, offset: number, out: Spanned[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectContaining(item, offset, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const span = (value as { span?: unknown }).span;
  if (!Array.isArray(span) || typeof span[0] !== 'number' || typeof span[1] !== 'number') return;
  if (offset < span[0] || offset > span[1]) return;
  out.push(value as Spanned);
  for (const item of Object.values(value)) collectContaining(item, offset, out);
}

function tokenAt(tokens: readonly Token[], offset: number): Token | undefined {
  return tokens.find((token) => offset >= token.span[0] && offset <= token.span[1] && token.kind !== 'EOF' && token.kind !== 'NEWLINE');
}

function lineSpan(analysis: Analysis, offset: number): [number, number] {
  const document = analysis.document;
  const line = document.positionAt(Math.min(offset, document.getText().length)).line;
  const start = document.offsetAt({ line, character: 0 });
  const end = document.offsetAt({ line, character: Number.MAX_SAFE_INTEGER });
  return [start, end];
}

export function selectionRanges(analysis: Analysis, positions: readonly Position[]): SelectionRange[] {
  return positions.map((position) => selectionAt(analysis, analysis.document.offsetAt(position)));
}

function selectionAt(analysis: Analysis, offset: number): SelectionRange {
  const program: Program | null = analysis.core.program;
  const spans: [number, number][] = [];
  const token = tokenAt(analysis.core.tokens, offset);
  if (token !== undefined) spans.push([token.span[0], token.span[1]]);
  if (program !== null) {
    const containing: Spanned[] = [];
    collectContaining(program, offset, containing);
    for (const node of containing) spans.push([node.span[0], node.span[1]]);
  }
  if (spans.length === 0) {
    spans.push(lineSpan(analysis, offset));
    spans.push([0, analysis.document.getText().length]);
  }

  const sorted = spans
    .sort((a, b) => a[1] - a[0] - (b[1] - b[0]))
    .filter((span, index, all) => index === 0 || span[0] !== all[index - 1]?.[0] || span[1] !== all[index - 1]?.[1]);

  let chain: SelectionRange | undefined;
  for (let index = sorted.length - 1; index >= 0; index--) {
    const span = sorted[index];
    if (span === undefined) continue;
    const range = spanToRange(analysis.document, span);
    chain = chain === undefined ? { range } : { range, parent: chain };
  }
  return chain ?? { range: spanToRange(analysis.document, [offset, offset]) };
}
