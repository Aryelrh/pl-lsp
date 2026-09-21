import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, type BangCall, type Program } from '../../src/analysis/core-adapter.js';
import {
  buildCapabilities,
  coverageGrants,
  describeBang,
  effectiveManifestAt,
  type CapabilityModel,
} from '../../src/analysis/capabilities.js';

const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');
const uncovered = readFileSync(new URL('../fixtures/uncovered.placitum', import.meta.url), 'utf8');

function programOf(source: string): Program {
  const program = analyze(source).program;
  if (program === null) throw new Error('fixture did not parse');
  return program;
}

function collectBangs(value: unknown, out: BangCall[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectBangs(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if ((value as { kind?: unknown }).kind === 'BangCall') out.push(value as BangCall);
    for (const item of Object.values(value)) collectBangs(item, out);
  }
}

function bangsOf(program: Program): BangCall[] {
  const bangs: BangCall[] = [];
  collectBangs(program.body, bangs);
  return bangs;
}

function modelOf(source: string): CapabilityModel {
  const core = analyze(source);
  if (core.program === null) throw new Error('fixture did not parse');
  return buildCapabilities(core.program, core.manifest);
}

describe('capabilities', () => {
  it('reads the extractor manifest and fn list', () => {
    const model = modelOf(rosetta);
    expect(model.manifest).not.toBeNull();
    expect(model.topNeeds).toHaveLength(1);
    expect(model.fns.map((fn) => fn.id)).toEqual(['load']);
  });

  it('selects the innermost attenuated manifest by offset', () => {
    const model = modelOf(rosetta);
    const bodyOffset = rosetta.indexOf('let data');
    const scoped = effectiveManifestAt(model, bodyOffset);
    expect(scoped).not.toBeNull();
    expect(coverageGrants(scoped ?? model.manifest!, 'fsRead')).toEqual(['/etc/**']);
    expect(scoped?.deferredToRuntime.length).toBeGreaterThan(0);
    const top = effectiveManifestAt(model, rosetta.indexOf('let cfg'));
    expect(coverageGrants(top ?? model.manifest!, 'net')).toEqual(['api.example.com']);
  });

  it('lets a fn without needs inherit through outer scopes to the top manifest', () => {
    const source = [
      'needs net("a.com")',
      'fn outer() {',
      '  fn inner() {',
      '    let r = curl!("https://a.com")',
      '  }',
      '}',
      '',
    ].join('\n');
    const model = modelOf(source);
    const innerBang = bangsOf(programOf(source))[0];
    expect(innerBang).toBeDefined();
    const info = describeBang(model, innerBang!);
    expect(info.status).toBe('statically-covered');
    expect(info.category).toBe('net');
  });

  it('describes ambient, covered, deferred and unknown bang calls', () => {
    const model = modelOf(rosetta);
    const byTarget = new Map(bangsOf(programOf(rosetta)).map((bang) => [bang.target, bang]));
    expect(describeBang(model, byTarget.get('print')!)).toMatchObject({ status: 'ambient', category: null });
    expect(describeBang(model, byTarget.get('curl')!)).toMatchObject({ status: 'statically-covered', category: 'net' });
    expect(describeBang(model, byTarget.get('fs.readFile')!)).toMatchObject({ status: 'deferred', category: 'fsRead' });
  });

  it('reports unknown targets and extraction failures conservatively', () => {
    const unknownSource = 'needs net("a.com")\nunknown_effect!("x")\n';
    const unknownModel = modelOf(unknownSource);
    const [unknownBang] = bangsOf(programOf(unknownSource));
    expect(describeBang(unknownModel, unknownBang!)).toMatchObject({ status: 'unknown', category: null });

    const failedModel = modelOf(uncovered);
    expect(failedModel.manifest).toBeNull();
    const [failedBang] = bangsOf(programOf(uncovered));
    expect(describeBang(failedModel, failedBang!)).toMatchObject({ status: 'unknown', category: 'fsRead' });
  });

  it('returns raw grant patterns per category', () => {
    const model = modelOf(rosetta);
    const manifest = model.manifest;
    if (manifest === null) throw new Error('expected manifest');
    expect(coverageGrants(manifest, 'net')).toEqual(['api.example.com']);
    expect(coverageGrants(manifest, 'fsRead')).toEqual(['/etc/**']);
    expect(coverageGrants(manifest, 'exec')).toEqual(['/usr/bin/*']);
    expect(coverageGrants(manifest, 'fsWrite')).toEqual([]);
  });
});
