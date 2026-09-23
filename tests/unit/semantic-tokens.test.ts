import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { semanticTokens, TOKEN_MODIFIERS, TOKEN_TYPES } from '../../src/features/semantic-tokens.js';

const fixture = readFileSync(new URL('../fixtures/tokens.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///tokens.placitum', 'placitum', 1, source));
}

function decode(analysis: Analysis): string[] {
  const { data } = semanticTokens(analysis);
  const lines = analysis.document.getText().split('\n');
  const decoded: string[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index] ?? 0;
    const deltaCharacter = data[index + 1] ?? 0;
    const length = data[index + 2] ?? 0;
    const type = data[index + 3] ?? 0;
    const modifiers = data[index + 4] ?? 0;
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaCharacter : deltaCharacter;
    const text = lines[line]?.slice(character, character + length) ?? '?';
    const names = TOKEN_MODIFIERS.filter((_, bit) => (modifiers & (1 << bit)) !== 0);
    decoded.push(`${text}:${TOKEN_TYPES[type]}${names.length === 0 ? '' : `+${names.join('+')}`}`);
  }
  return decoded;
}

describe('semanticTokens', () => {
  it('classifies the golden fixture end to end', () => {
    expect(decode(analysisOf(fixture))).toEqual([
      '#!:operator',
      'strict:macro',
      '# comment about the program:comment',
      'needs:keyword',
      'net:keyword',
      '"api.example.com":string',
      'fs:keyword',
      'read:keyword',
      '"/etc/**":string',
      'let:keyword',
      'x:variable+declaration',
      '=:operator',
      '1:number',
      'x:variable+modification',
      '=:operator',
      '2:number',
      'let:keyword',
      'obj:variable+declaration+readonly',
      '=:operator',
      'key:property',
      '"value":string',
      'let:keyword',
      'text:variable+declaration+readonly',
      '=:operator',
      'f"x is :string',
      'x:variable',
      '":string',
      'let:keyword',
      'parsed:variable+declaration+readonly',
      '=:operator',
      'json:namespace+defaultLibrary',
      'parse:function+defaultLibrary',
      'text:variable',
      'let:keyword',
      'r:variable+declaration+readonly',
      '=:operator',
      'curl:function+defaultLibrary',
      '!:operator',
      '"https://api.example.com/v1":string',
      'print:function+defaultLibrary',
      '!:operator',
      'r:variable',
    ]);
  });

  it('returns an empty stream when lexing produced no usable tokens', () => {
    expect(semanticTokens(analysisOf('@\n')).data).toEqual([]);
  });

  it('never emits overlapping tokens or throws on broken input', () => {
    for (const source of ['', 'let x = "abc\n', 'fn f() {', 'let x = 1 @ 2\n']) {
      expect(() => decode(analysisOf(source))).not.toThrow();
    }
  });
});
