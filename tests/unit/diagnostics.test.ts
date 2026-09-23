import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis } from '../../src/analysis/model.js';
import { DEFAULT_CONFIG, resolveConfig } from '../../src/config.js';
import { computeDiagnostics, documentDiagnostic } from '../../src/features/diagnostics.js';

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
      quickFixes: ['add-needs'],
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

  it('maps binder E500 diagnostics with ranges and eval phase data', () => {
    const diagnostics = computeDiagnostics(analysisOf('let copy = missing_name\n'), DEFAULT_CONFIG);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'E500_EVAL_UNBOUND_VAR',
      range: { start: { line: 0, character: 11 }, end: { line: 0, character: 23 } },
      data: { phase: 'eval', hint: 'Declare it with `let` before use.' },
    });
  });

  it('maps E506 and sorts diagnostics by source offset', () => {
    const diagnostics = computeDiagnostics(analysisOf('let x = 1\nlet x = 2\nlet y = 1 + "a"\n'), DEFAULT_CONFIG);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'E506_EVAL_REDECLARATION',
      'E501_EVAL_TYPE_MISMATCH',
    ]);
  });

  it('gates scope, strict and literal checks independently', () => {
    const source = '#!strict\nlet copy = missing_name\nlet s = 1 + "a"\n1 | json.parse\n';
    const all = computeDiagnostics(analysisOf(source), DEFAULT_CONFIG);
    expect(all.map((diagnostic) => diagnostic.code)).toEqual([
      'E500_EVAL_UNBOUND_VAR',
      'E501_EVAL_TYPE_MISMATCH',
      'E505_EVAL_PIPE_TYPE_ERROR',
    ]);

    const config = resolveConfig({ diagnostics: { scope: false, strictChecks: false, literalTypes: false } });
    expect(computeDiagnostics(analysisOf(source), config)).toEqual([]);
  });

  it('builds pull reports with version+config result ids', () => {
    const analysis = analysisOf(uncovered);
    const full = documentDiagnostic(analysis, DEFAULT_CONFIG);
    expect(full).toMatchObject({
      kind: 'full',
      items: [{ code: 'E301_EXTRACT_UNCOVERED_CAPABILITY' }],
    });
    const resultId = 'resultId' in full ? full.resultId : undefined;
    expect(resultId).toBeDefined();
    expect(documentDiagnostic(analysis, DEFAULT_CONFIG, resultId)).toEqual({ kind: 'unchanged', resultId });

    const disabled = resolveConfig({ diagnostics: { enable: false } });
    const changed = documentDiagnostic(analysis, disabled, resultId);
    expect(changed).toMatchObject({ kind: 'full', items: [] });
    expect('resultId' in changed ? changed.resultId : undefined).not.toBe(resultId);
  });

  it('does not report semantic errors on a recovered parse', () => {
    const diagnostics = computeDiagnostics(analysisOf('let x = "abc\nlet y = missing_name\n'), DEFAULT_CONFIG);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['E101_LEX_UNTERMINATED_STRING']);
  });
});
