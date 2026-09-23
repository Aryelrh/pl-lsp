/**
 * Position math: core UTF-16 offsets/line/col <-> LSP Range, with clamping.
 * Every offset conversion in the server goes through this module.
 */
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Range } from 'vscode-languageserver/node.js';
import type { PlacitumError } from './core-adapter.js';

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Convert a core [start, end) UTF-16 span to a clamped LSP range. */
export function spanToRange(document: TextDocument, span: readonly [number, number]): Range {
  const text = document.getText();
  const start = clamp(span[0], 0, text.length);
  let end = clamp(span[1], 0, text.length);
  if (end < start) end = start;
  // Never let a range edge sit between the CR and LF of a CRLF pair.
  if (end > start && end < text.length && text.charCodeAt(end) === 10 && text.charCodeAt(end - 1) === 13) {
    end -= 1;
  }
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

/** Convert a core diagnostic location to an LSP range, tolerating missing/bad data. */
export function errorRange(document: TextDocument, error: PlacitumError): Range {
  const location = error.location;
  if (location === undefined) {
    const origin = document.positionAt(0);
    return { start: origin, end: origin };
  }
  if (location.span !== undefined) return spanToRange(document, location.span);
  const line = clamp(location.line - 1, 0, document.lineCount - 1);
  const start = document.offsetAt({ line, character: clamp(location.col - 1, 0, Number.MAX_SAFE_INTEGER) });
  const lineEnd = document.offsetAt({ line, character: Number.MAX_SAFE_INTEGER });
  const end = start < lineEnd ? start + 1 : lineEnd;
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
