/**
 * Read-only capability queries over the extractor's manifest (§6.6).
 * Never re-derives patterns; a parse that failed extraction answers "unknown".
 */
import {
  AMBIENT_BANGS,
  BANG_REGISTRY,
  type BangCall,
  type EffectCategory,
  type FnDecl,
  type NeedsDecl,
  type Program,
  type SerializedManifest,
  type Statement,
} from './core-adapter.js';

export interface CapabilityModel {
  manifest: SerializedManifest | null;
  topNeeds: NeedsDecl[];
  fns: FnDecl[];
}

export type BangStatus = 'ambient' | 'deferred' | 'statically-covered' | 'unknown';

export interface BangInfo {
  target: string;
  category: EffectCategory | null;
  status: BangStatus;
}

function collectFns(statements: readonly Statement[], into: FnDecl[]): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case 'FnDecl':
        into.push(statement);
        collectFns(statement.body.body, into);
        break;
      case 'IfStmt':
        collectFns(statement.consequent.body, into);
        if (statement.alternate !== null) {
          if (statement.alternate.kind === 'IfStmt') collectFns([statement.alternate], into);
          else collectFns(statement.alternate.body, into);
        }
        break;
      case 'WhileStmt':
      case 'ForStmt':
        collectFns(statement.body.body, into);
        break;
      default:
        break;
    }
  }
}

export function buildCapabilities(program: Program, manifest: SerializedManifest | null): CapabilityModel {
  const fns: FnDecl[] = [];
  collectFns(program.body, fns);
  return { manifest, topNeeds: program.needs, fns };
}

function contains(span: readonly [number, number], offset: number): boolean {
  return offset >= span[0] && offset < span[1];
}

/** Innermost enclosing fn's attenuated manifest, or the top-level one. */
export function effectiveManifestAt(model: CapabilityModel, offset: number): SerializedManifest | null {
  const enclosing = model.fns
    .filter((fn) => contains(fn.span, offset))
    .sort((a, b) => a.span[1] - a.span[0] - (b.span[1] - b.span[0]));
  for (const fn of enclosing) {
    if (fn.needs === null || model.manifest === null) continue;
    const scoped = model.manifest.scoped[fn.id];
    if (scoped !== undefined) return scoped;
  }
  return model.manifest;
}

export function describeBang(model: CapabilityModel, bang: BangCall): BangInfo {
  if ((AMBIENT_BANGS as readonly string[]).includes(bang.target)) {
    return { target: bang.target, category: null, status: 'ambient' };
  }
  if (!Object.hasOwn(BANG_REGISTRY, bang.target)) {
    return { target: bang.target, category: null, status: 'unknown' };
  }
  const category = BANG_REGISTRY[bang.target] ?? null;
  const manifest = effectiveManifestAt(model, bang.span[0]);
  if (manifest === null) return { target: bang.target, category, status: 'unknown' };
  const deferred = manifest.deferredToRuntime.some(
    (check) => check.nodeSpan[0] === bang.span[0] && check.nodeSpan[1] === bang.span[1],
  );
  return { target: bang.target, category, status: deferred ? 'deferred' : 'statically-covered' };
}

/** Raw grant patterns for a category, exactly as the extractor recorded them. */
export function coverageGrants(manifest: SerializedManifest, category: EffectCategory): string[] {
  switch (category) {
    case 'net':
      return manifest.net.map((host) => host.pattern);
    case 'fsRead':
      return manifest.fsRead.map((glob) => glob.raw);
    case 'fsWrite':
      return manifest.fsWrite.map((glob) => glob.raw);
    case 'exec':
      return manifest.exec.map((glob) => glob.raw);
  }
}
