import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { errorRange, spanToRange } from '../../src/analysis/positions.js';
import type { PlacitumError } from '../../src/analysis/core-adapter.js';

function doc(text: string): TextDocument {
  return TextDocument.create('file:///test.placitum', 'placitum', 1, text);
}

function error(location: PlacitumError['location']): PlacitumError {
  return location === undefined
    ? { code: 'E000_TEST', phase: 'lex', severity: 'error', message: 'test' }
    : { code: 'E000_TEST', phase: 'lex', severity: 'error', message: 'test', location };
}

describe('spanToRange', () => {
  it('maps ASCII spans across lines', () => {
    const text = doc('abc\ndef');
    expect(spanToRange(text, [0, 3])).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 3 },
    });
    expect(spanToRange(text, [4, 7])).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 3 },
    });
  });

  it('treats astral characters as surrogate pairs (UTF-16 code units)', () => {
    const text = doc('a😀b');
    expect(spanToRange(text, [1, 3])).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 3 },
    });
    expect(spanToRange(text, [3, 4])).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: 4 },
    });
  });

  it('clamps out-of-range spans', () => {
    const text = doc('abc');
    expect(spanToRange(text, [-10, 99])).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 3 },
    });
    expect(spanToRange(text, [5, 7])).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
    });
  });

  it('normalizes reversed spans to zero width', () => {
    expect(spanToRange(doc('abcdef'), [4, 2])).toEqual({
      start: { line: 0, character: 4 },
      end: { line: 0, character: 4 },
    });
  });

  it('never lets a range edge sit between CR and LF', () => {
    expect(spanToRange(doc('a\r\nb'), [1, 2])).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 1 },
    });
  });
});

describe('errorRange', () => {
  it('uses the span when present', () => {
    expect(errorRange(doc('abc'), error({ line: 1, col: 2, span: [1, 2] }))).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 2 },
    });
  });

  it('falls back to a one-code-unit range at line/col', () => {
    expect(errorRange(doc('abc\ndef'), error({ line: 2, col: 2 }))).toEqual({
      start: { line: 1, character: 1 },
      end: { line: 1, character: 2 },
    });
  });

  it('clamps line/col past the end of a line to zero width', () => {
    expect(errorRange(doc('abc'), error({ line: 1, col: 99 }))).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
    });
  });

  it('clamps lines past EOF', () => {
    expect(errorRange(doc('abc'), error({ line: 9, col: 1 }))).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    });
  });

  it('returns the origin for a location-less error', () => {
    expect(errorRange(doc('abc'), error(undefined))).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
  });

  it('handles an empty document', () => {
    expect(errorRange(doc(''), error({ line: 1, col: 1 }))).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
  });
});
