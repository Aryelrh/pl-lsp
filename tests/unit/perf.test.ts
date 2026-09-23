import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createAnalysis } from '../../src/analysis/model.js';

describe('analysis performance', () => {
  it('analyzes a 1000-line program in under 50 ms', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `let value_${index} = ${index}`).join('\n');
    const document = TextDocument.create('file:///big.placitum', 'placitum', 1, source);
    createAnalysis(document);
    // Best of three: one sample can be preempted by a parallel test worker.
    let best = Number.POSITIVE_INFINITY;
    let complete = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      complete = createAnalysis(document).core.complete;
      best = Math.min(best, performance.now() - started);
    }
    expect(complete).toBe(true);
    expect(best).toBeLessThan(50);
  });
});
