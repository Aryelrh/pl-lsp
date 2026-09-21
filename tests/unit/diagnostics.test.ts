import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis } from '../../src/analysis/model.js';
import { DEFAULT_CONFIG, resolveConfig } from '../../src/config.js';
import { computeDiagnostics } from '../../src/features/diagnostics.js';

const uncovered = readFileSync(new URL('../fixtures/uncovered.placitum', import.meta.url), 'utf8');
const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(text: string) {
  return createAnalysis(TextDocument.create('file:///test.placitum', 'placitum', 1, text));
}

describe('computeDiagnostics', () => {
  it('maps the core E301 exactly as Appendix C specifies', () => {
    const diagnostics = computeDiagnostics(analysisOf(uncovered), DEFAULT_CONFIG);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic).toMatchObject({
      range: { start: { line: 0, character: 13 }, end: { line: 0, character: 42 } },
      severity: 1,
      code: 'E301_EXTRACT_UNCOVERED_CAPABILITY',
      source: 'placitum',
    });
    expect(diagnostic?.message).toBe(
      'fs.readFile!("/etc/app.json") has a compile-time-literal target that no in-scope needs fs.read(...) token covers.\n\nhint: Add needs fs.read("/etc/app.json") at the top of the script, or delete the call.',
    );
    expect(diagnostic?.data).toEqual({
      phase: 'extract',
      hint: 'Add needs fs.read("/etc/app.json") at the top of the script, or delete the call.',
    });
  });

  it('keeps the message plain when the core error has no hint', () => {
    const diagnostics = computeDiagnostics(analysisOf('let x = 1 @ 2'), DEFAULT_CONFIG);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe('Unexpected character "@".');
    expect(diagnostics[0]?.data).toEqual({ phase: 'lex' });
  });

  it('returns nothing for a clean program', () => {
    expect(computeDiagnostics(analysisOf(rosetta), DEFAULT_CONFIG)).toEqual([]);
  });

  it('returns nothing when diagnostics are disabled', () => {
    const config = resolveConfig({ diagnostics: { enable: false } });
    expect(computeDiagnostics(analysisOf(uncovered), config)).toEqual([]);
  });

  it('never throws on empty or hostile input', () => {
    for (const text of ['', '\n\n', '# only a comment', '"unterminated']) {
      expect(() => computeDiagnostics(analysisOf(text), DEFAULT_CONFIG)).not.toThrow();
    }
  });
});
