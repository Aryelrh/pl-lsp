/** Full semantic tokens: AST-derived spans first, token-kind fallback second (directive §7.8). */
import type { SemanticTokens } from 'vscode-languageserver/node.js';
import {
  BANG_SIGNATURES,
  type BangCall,
  type MemberExpr,
  type NeedsDecl,
  type ObjectProperty,
  type Program,
  type TokenKind,
} from '../analysis/core-adapter.js';
import { isWritten, nameSpanIn } from '../analysis/binder.js';
import type { Analysis } from '../analysis/model.js';
import { collectNodes } from '../analysis/walk.js';

export const TOKEN_TYPES = [
  'namespace',
  'variable',
  'parameter',
  'property',
  'function',
  'keyword',
  'comment',
  'string',
  'number',
  'operator',
  'macro',
] as const;

export const TOKEN_MODIFIERS = ['declaration', 'readonly', 'defaultLibrary', 'modification'] as const;

const TYPE_INDEX = new Map<string, number>(TOKEN_TYPES.map((type, index) => [type, index]));

const MODIFIER_DECLARATION = 1 << 0;
const MODIFIER_READONLY = 1 << 1;
const MODIFIER_DEFAULT_LIBRARY = 1 << 2;
const MODIFIER_MODIFICATION = 1 << 3;

const KEYWORD_KINDS = new Set<TokenKind>(['NEEDS', 'LET', 'FN', 'IF', 'ELSE', 'WHILE', 'FOR', 'IN', 'RETURN', 'NOT', 'ONLY', 'TRUE', 'FALSE', 'NULL']);
const OPERATOR_KINDS = new Set<TokenKind>(['PIPE', 'OR', 'AND', 'EQ', 'NEQ', 'LT', 'GT', 'LTE', 'GTE', 'ASSIGN', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'BANG', 'QUESTION']);
const STRING_KINDS = new Set<TokenKind>(['STRING', 'STRING_CHUNK', 'FSTRING_START', 'FSTRING_END']);

interface Classified {
  span: [number, number];
  type: number;
  modifiers: number;
}

function typeIndex(name: string): number {
  return TYPE_INDEX.get(name) ?? 0;
}

export function semanticTokens(analysis: Analysis): SemanticTokens {
  const program: Program | null = analysis.core.program;
  const tokens = analysis.core.tokens;
  if (tokens.length === 0) return { data: [] };
  const classified: Classified[] = [];
  const claimed = new Set<number>();
  const push = (span: readonly [number, number], type: number, modifiers: number): void => {
    if (span[1] <= span[0]) return;
    classified.push({ span: [span[0], span[1]], type, modifiers });
    claimed.add(span[0]);
  };

  const binder = analysis.binder;
  if (binder !== null && program !== null) {
    const source = analysis.document.getText();
    for (const binding of binder.bindings) {
      if (binding.kind === 'builtin') continue;
      const type = typeIndex(binding.kind === 'fn' ? 'function' : binding.kind === 'param' ? 'parameter' : 'variable');
      let modifiers = MODIFIER_DECLARATION;
      if (binding.kind !== 'fn' && !isWritten(binder, binding.id)) modifiers |= MODIFIER_READONLY;
      push(binding.nameSpan, type, modifiers);
    }
    for (const occurrence of binder.occurrences) {
      const binding = binder.bindings[occurrence.binding];
      if (binding === undefined) continue;
      if (binding.kind === 'builtin') {
        push(occurrence.span, typeIndex('namespace'), MODIFIER_DEFAULT_LIBRARY);
        continue;
      }
      const type = typeIndex(binding.kind === 'fn' ? 'function' : binding.kind === 'param' ? 'parameter' : 'variable');
      push(occurrence.span, type, occurrence.mode === 'write' ? MODIFIER_MODIFICATION : 0);
    }
    for (const property of collectNodes<ObjectProperty>(program.body, 'ObjectProperty')) {
      push(nameSpanIn(source, property.span[0], property.key), typeIndex('property'), 0);
    }
    for (const member of collectNodes<MemberExpr>(program.body, 'MemberExpr')) {
      if (member.object.kind === 'Identifier' && member.object.name === 'json' && member.property === 'parse') {
        push([member.span[1] - member.property.length, member.span[1]], typeIndex('function'), MODIFIER_DEFAULT_LIBRARY);
      }
    }
    for (const bang of collectNodes<BangCall>(program.body, 'BangCall')) {
      if (Object.hasOwn(BANG_SIGNATURES, bang.target)) {
        push([bang.span[0], bang.span[0] + bang.target.length], typeIndex('function'), MODIFIER_DEFAULT_LIBRARY);
      }
    }
  }

  for (const token of tokens) {
    if (token.kind !== 'PRAGMA') continue;
    push([token.span[0], token.span[0] + 2], typeIndex('operator'), 0);
    const name = nameSpanIn(analysis.document.getText(), token.span[0] + 2, 'strict');
    if (name[1] > name[0] && name[1] <= token.span[1]) push(name, typeIndex('macro'), 0);
  }
  for (const comment of analysis.comments) push(comment.span, typeIndex('comment'), 0);

  const needsSpans: [number, number][] = program === null
    ? []
    : collectNodes<NeedsDecl>(program, 'NeedsDecl').map((needs) => [needs.span[0], needs.span[1]]);
  const inNeeds = (span: readonly [number, number]): boolean =>
    needsSpans.some((needs) => span[0] >= needs[0] && span[1] <= needs[1]);

  for (const token of tokens) {
    if (claimed.has(token.span[0])) continue;
    if (KEYWORD_KINDS.has(token.kind)) {
      push(token.span, typeIndex('keyword'), 0);
    } else if (token.kind === 'IDENTIFIER' && inNeeds(token.span)) {
      push(token.span, typeIndex('keyword'), 0);
    } else if (STRING_KINDS.has(token.kind)) {
      push(token.span, typeIndex('string'), 0);
    } else if (token.kind === 'NUMBER') {
      push(token.span, typeIndex('number'), 0);
    } else if (OPERATOR_KINDS.has(token.kind)) {
      push(token.span, typeIndex('operator'), 0);
    }
  }

  return { data: encode(analysis, classified) };
}

function encode(analysis: Analysis, classified: Classified[]): number[] {
  const document = analysis.document;
  classified.sort((a, b) => a.span[0] - b.span[0]);
  const merged: Classified[] = [];
  let lastEnd = -1;
  for (const token of classified) {
    if (token.span[0] < lastEnd) continue; // never overlap
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.span[1] === token.span[0] && previous.type === token.type && previous.modifiers === token.modifiers) {
      previous.span[1] = token.span[1];
    } else {
      merged.push(token);
    }
    lastEnd = token.span[1];
  }
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of merged) {
    const start = document.positionAt(token.span[0]);
    const end = document.positionAt(token.span[1]);
    if (start.line !== end.line) continue; // deltas cannot express multi-line tokens
    const deltaLine = start.line - previousLine;
    const deltaCharacter = deltaLine === 0 ? start.character - previousCharacter : start.character;
    data.push(deltaLine, deltaCharacter, end.character - start.character, token.type, token.modifiers);
    previousLine = start.line;
    previousCharacter = start.character;
  }
  return data;
}
