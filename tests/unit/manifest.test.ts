import { readFileSync } from 'node:fs';
import { explain } from 'placitum';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { createAnalysis, type Analysis } from '../../src/analysis/model.js';
import { capMessage, manifestPayload, MESSAGE_CAP } from '../../src/features/manifest-command.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function analysisOf(source: string): Analysis {
  return createAnalysis(TextDocument.create('file:///manifest.placitum', 'placitum', 1, source));
}

describe('manifestPayload', () => {
  it('renders the core explain output byte for byte', () => {
    const analysis = analysisOf(rosetta);
    const payload = manifestPayload(analysis);
    expect(payload.manifest).not.toBeNull();
    expect(payload.markdown).toBe(explain(analysis.core.manifest));
    expect(payload.markdown).toContain('grants (statically proven):');
    expect(payload.markdown).toContain('fn load (attenuated needs only(...)):');
  });

  it('lists diagnostics and a hint when the manifest cannot be built', () => {
    const analysis = analysisOf('let config = fs.readFile!("/etc/app.json")\n');
    const payload = manifestPayload(analysis);
    expect(payload.manifest).toBeNull();
    expect(payload.markdown).toContain('E301_EXTRACT_UNCOVERED_CAPABILITY');
    expect(payload.markdown).toContain('Fix the capability errors to see the manifest.');
    expect(payload.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['E301_EXTRACT_UNCOVERED_CAPABILITY']);
  });

  it('points at syntax errors when parsing failed', () => {
    const payload = manifestPayload(analysisOf('let x = "abc\n'));
    expect(payload.markdown).toContain('Fix the syntax errors to see the manifest.');
  });

  it('caps the showMessage text but keeps the full markdown', () => {
    const long = 'x'.repeat(MESSAGE_CAP + 100);
    expect(capMessage(long).length).toBeLessThan(long.length);
    expect(capMessage(long)).toContain('truncated');
    expect(capMessage('short')).toBe('short');
  });
});
