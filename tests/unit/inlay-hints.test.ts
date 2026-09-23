import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { inlayHints } from '../../src/features/inlay-hints.js';

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///hints.placitum', 'placitum', 1, source));
}

function fullRange(analysis: Analysis) {
  return { start: { line: 0, character: 0 }, end: analysis.document.positionAt(analysis.document.getText().length) };
}

describe('inlayHints', () => {
  it('annotates let bindings with a known inferred type', () => {
    const source = 'let x = 1\nlet y = "a"\nlet z = missing\n';
    const analysis = analysisOf(source);
    const hints = inlayHints(analysis, fullRange(analysis), { capabilities: false });
    expect(hints.map((hint) => [hint.label, hint.position.line, hint.position.character])).toEqual([
      [': number', 0, 5],
      [': string', 1, 5],
    ]);
  });

  it('filters hints to the requested range', () => {
    const source = 'let x = 1\nlet y = "a"\n';
    const analysis = analysisOf(source);
    const hints = inlayHints(analysis, { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } }, { capabilities: false });
    expect(hints.map((hint) => hint.label)).toEqual([': string']);
  });

  it('shows coverage only for statically covered bang calls when enabled', () => {
    const source = 'needs net("api.example.com")\nlet r = curl!("https://api.example.com/v1")\n';
    const analysis = analysisOf(source);
    const without = inlayHints(analysis, fullRange(analysis), { capabilities: false });
    expect(without.some((hint) => typeof hint.label === 'string' && hint.label.startsWith('needs '))).toBe(false);
    const hints = inlayHints(analysis, fullRange(analysis), { capabilities: true });
    expect(hints.some((hint) => hint.label === 'needs net("api.example.com")')).toBe(true);
  });

  it('never annotates deferred bang calls', () => {
    const source = 'needs fs.read("/etc/**")\nlet path = "/etc/app.json"\nlet x = fs.readFile!(path)\n';
    const analysis = analysisOf(source);
    const hints = inlayHints(analysis, fullRange(analysis), { capabilities: true });
    expect(hints.some((hint) => typeof hint.label === 'string' && hint.label.startsWith('needs '))).toBe(false);
  });
});
