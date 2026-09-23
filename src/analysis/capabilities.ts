/**
 * Read-only capability queries over the extractor's manifest (§6.6).
 * Never re-derives patterns; a parse that failed extraction answers "unknown".
 */
import {
  AMBIENT_BANGS,
  BANG_REGISTRY,
  globCovers,
  hostToRegex,
  type BangCall,
  type CapabilityToken,
  type EffectCategory,
  type FnDecl,
  type NeedsDecl,
  type Program,
  type SerializedManifest,
  type Statement,
} from './core-adapter.js';
import { collectNodes } from './walk.js';

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

/** Capability token text for a raw grant pattern, as it would appear in `needs`. */
export function grantTokenText(category: EffectCategory, pattern: string): string {
  switch (category) {
    case 'net':
      return `net("${pattern}")`;
    case 'fsRead':
      return `fs.read("${pattern}")`;
    case 'fsWrite':
      return `fs.write("${pattern}")`;
    case 'exec':
      return `exec("${pattern}")`;
  }
}

/** Every grant of a manifest as `needs` token text (used by hover and completion). */
export function manifestTokenTexts(manifest: SerializedManifest): string[] {
  const tokens: string[] = [];
  for (const host of manifest.net) tokens.push(grantTokenText('net', host.pattern));
  for (const glob of manifest.fsRead) tokens.push(grantTokenText('fsRead', glob.raw));
  for (const glob of manifest.fsWrite) tokens.push(grantTokenText('fsWrite', glob.raw));
  for (const glob of manifest.exec) tokens.push(grantTokenText('exec', glob.raw));
  for (const env of manifest.env) tokens.push(`env(${env.name}${env.optional ? '?' : ''})`);
  return tokens;
}

/** Manifest of the scope enclosing a fn (its own `needs` excluded). */
export function parentManifestOf(model: CapabilityModel, fn: FnDecl): SerializedManifest | null {
  const enclosing = model.fns
    .filter((candidate) => candidate !== fn && contains(candidate.span, fn.span[0]))
    .sort((a, b) => a.span[1] - a.span[0] - (b.span[1] - b.span[0]));
  for (const outer of enclosing) {
    if (outer.needs === null || model.manifest === null) continue;
    const scoped = model.manifest.scoped[outer.id];
    if (scoped !== undefined) return scoped;
  }
  return model.manifest;
}

function categoryOfToken(token: CapabilityToken): EffectCategory | null {
  switch (token.kind) {
    case 'FsReadCapability':
      return 'fsRead';
    case 'FsWriteCapability':
      return 'fsWrite';
    case 'NetCapability':
      return 'net';
    case 'ExecCapability':
      return 'exec';
    case 'EnvCapability':
      return null;
    case 'OnlyCapability':
      return categoryOfToken(token.inner);
  }
}

function tokenCoversLiteral(token: CapabilityToken, value: string): boolean {
  switch (token.kind) {
    case 'NetCapability': {
      let hostname: string;
      try {
        hostname = new URL(value).hostname;
      } catch {
        return false;
      }
      const type = token.pattern.startsWith('*.') ? 'wildcard' : 'exact';
      return hostToRegex(type, token.pattern).test(hostname);
    }
    case 'FsReadCapability':
    case 'FsWriteCapability':
    case 'ExecCapability':
      return globCovers(token.pattern, value);
    case 'EnvCapability':
      return false;
    case 'OnlyCapability':
      return tokenCoversLiteral(token.inner, value);
  }
}

/** Whether any literal bang call in the program is covered by this capability token. */
export function isTokenUsed(program: Program, token: CapabilityToken): boolean {
  const category = categoryOfToken(token);
  if (category === null) return false;
  for (const bang of collectNodes<BangCall>(program.body, 'BangCall')) {
    if (BANG_REGISTRY[bang.target] !== category) continue;
    const argument = bang.args[0];
    if (argument === undefined || argument.kind !== 'StringLiteral') continue;
    if (tokenCoversLiteral(token, argument.value)) return true;
  }
  return false;
}
