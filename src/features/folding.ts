/** Folding ranges from the AST, with a brace-matching fallback (directive §7.9). */
import type { FoldingRange } from 'vscode-languageserver/node.js';
import type { ArrayLiteral, Block, FStringExpr, ObjectLiteral, Program, Token } from '../analysis/core-adapter.js';
import type { Analysis } from '../analysis/model.js';
import { collectNodes } from '../analysis/walk.js';

export function foldingRanges(analysis: Analysis): FoldingRange[] {
  const program: Program | null = analysis.core.program;
  const parseClean = program !== null && !analysis.core.diagnostics.some((diagnostic) => diagnostic.phase === 'parse');
  if (!parseClean || program === null) return braceFolding(analysis);
  const document = analysis.document;
  const ranges: FoldingRange[] = [];
  const pushRegion = (span: readonly [number, number]): void => {
    const start = document.positionAt(span[0]);
    const end = document.positionAt(Math.max(span[0], span[1] - 1));
    if (start.line < end.line) ranges.push({ startLine: start.line, endLine: end.line, kind: 'region' });
  };

  for (const block of collectNodes<Block>(program.body, 'Block')) pushRegion(block.span);
  for (const literal of collectNodes<ObjectLiteral>(program.body, 'ObjectLiteral')) pushRegion(literal.span);
  for (const literal of collectNodes<ArrayLiteral>(program.body, 'ArrayLiteral')) pushRegion(literal.span);
  for (const fstring of collectNodes<FStringExpr>(program.body, 'FStringExpr')) pushRegion(fstring.span);

  const needsLines = program.needs.map((needs) => {
    const start = document.positionAt(needs.span[0]);
    const end = document.positionAt(Math.max(needs.span[0], needs.span[1] - 1));
    return { start: start.line, end: end.line };
  });
  for (const group of groupConsecutive(needsLines)) {
    if (group.start < group.end) ranges.push({ startLine: group.start, endLine: group.end, kind: 'region' });
  }

  const commentLines = analysis.comments.map((comment) => {
    const start = document.positionAt(comment.span[0]);
    const end = document.positionAt(Math.max(comment.span[0], comment.span[1] - 1));
    return { start: start.line, end: end.line };
  });
  for (const group of groupConsecutive(commentLines)) {
    if (group.start < group.end) ranges.push({ startLine: group.start, endLine: group.end, kind: 'comment' });
  }

  ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return ranges;
}

function groupConsecutive(lines: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  const groups: { start: number; end: number }[] = [];
  for (const line of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && line.start <= last.end + 1) {
      last.end = Math.max(last.end, line.end);
    } else {
      groups.push({ start: line.start, end: line.end });
    }
  }
  return groups;
}

/** Tolerant fallback: match braces over the token stream (strings are never tokens). */
function braceFolding(analysis: Analysis): FoldingRange[] {
  const document = analysis.document;
  const ranges: FoldingRange[] = [];
  const open: Token[] = [];
  for (const token of analysis.core.tokens) {
    if (token.kind === 'LBRACE') {
      open.push(token);
    } else if (token.kind === 'RBRACE') {
      const start = open.pop();
      if (start === undefined) continue;
      const startLine = document.positionAt(start.span[0]).line;
      const endLine = document.positionAt(token.span[1] - 1).line;
      if (startLine < endLine) ranges.push({ startLine, endLine, kind: 'region' });
    }
  }
  ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return ranges;
}
