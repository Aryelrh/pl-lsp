import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis } from '../../src/analysis/model.js';

describe('analysis performance', () => {
  it('analyzes a 1000-line program in under 50 ms', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `let value_${index} = ${index}`).join('\n');
    const document = TextDocument.create('file:///big.placitum', 'placitum', 1, source);
    createAnalysis(document);
    const started = performance.now();
    const analysis = createAnalysis(document);
    const elapsed = performance.now() - started;
    expect(analysis.core.complete).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});
