import { readFileSync } from 'node:fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { codeLenses } from '../../src/features/code-lens.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///lens.placitum', 'placitum', 1, source));
}

describe('codeLenses', () => {
  it('summarizes the top-level needs and the attenuated fn', () => {
    const lenses = codeLenses(analysisOf(rosetta));
    expect(lenses.map((lens) => lens.command?.title)).toEqual([
      '4 grants · 0 deferred — show manifest',
      'needs only(fs.read("/etc/**"))',
    ]);
    expect(lenses[0]?.range.start.line).toBe(1);
    expect(lenses[1]?.range.start.line).toBe(4);
    expect(lenses[0]?.command?.command).toBe('placitum.showManifest');
  });

  it('falls back to AST token counts when extraction failed', () => {
    const source = 'needs fs.read("/etc/**")\nlet x = fs.readFile!("/etc/app.json")\n';
    const lenses = codeLenses(analysisOf(source));
    expect(lenses[0]?.command?.title).toBe('1 grant · 0 deferred — show manifest');
  });

  it('has no lenses when the file does not parse', () => {
    expect(codeLenses(analysisOf('fn f() {\n  let x = 1\n'))).toEqual([]);
  });
});
