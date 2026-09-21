import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, CORE_API_VERSION } from '../../src/analysis/core-adapter.js';

describe('core adapter', () => {
  it('records the pinned core commit SHA', () => {
    expect(CORE_API_VERSION).toMatch(/^[0-9a-f]{40}$/);
  });

  it('analyzes the Rosetta fixture through the core barrel', () => {
    const source = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');
    const result = analyze(source);
    expect(result.complete).toBe(true);
    expect(result.program?.kind).toBe('Program');
    expect(result.manifest).not.toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it('degrades to a diagnostic instead of throwing on malformed input', () => {
    const result = analyze('let x = "abc');
    expect(result.complete).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['E101_LEX_UNTERMINATED_STRING']);
    expect(() => analyze('fn f() {')).not.toThrow();
  });
});
