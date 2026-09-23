/**
 * Comment trivia: the core lexer's output when available, otherwise a tolerant
 * scan of the gaps between token spans (strings/f-strings never yield comments).
 */
import type { CommentTrivia, Token } from './core-adapter.js';

function copy(trivia: CommentTrivia): CommentTrivia {
  return { span: [trivia.span[0], trivia.span[1]] };
}

// Only string-like tokens can hide a `#`; NEWLINE runs span entire comment
// lines, so they must not count as coverage in the fallback scan.
const STRING_TOKEN_KINDS = new Set(['STRING', 'STRING_CHUNK', 'FSTRING_START', 'FSTRING_END']);

function scanGaps(source: string, tokens: readonly Token[]): CommentTrivia[] {
  const covered = tokens
    .filter((token) => STRING_TOKEN_KINDS.has(token.kind))
    .map((token) => token.span)
    .sort((a, b) => a[0] - b[0]);
  const isCovered = (offset: number): boolean => covered.some(([start, end]) => offset >= start && offset < end);
  const trivia: CommentTrivia[] = [];
  let cursor = 0;
  for (;;) {
    const hash = source.indexOf('#', cursor);
    if (hash === -1) break;
    // The physical line-1 `#!` is a pragma token, not a comment.
    if (hash === 0 && source.charAt(1) === '!') {
      const eol = source.indexOf('\n', hash);
      cursor = eol === -1 ? source.length : eol + 1;
      continue;
    }
    if (!isCovered(hash)) {
      const eol = source.indexOf('\n', hash);
      trivia.push({ span: [hash, eol === -1 ? source.length : eol] });
      cursor = eol === -1 ? source.length : eol + 1;
      continue;
    }
    cursor = hash + 1;
  }
  return trivia;
}

export function collectComments(source: string, tokens: readonly Token[], lexed: readonly CommentTrivia[]): CommentTrivia[] {
  if (lexed.length > 0) return lexed.map(copy);
  return scanGaps(source, tokens);
}
