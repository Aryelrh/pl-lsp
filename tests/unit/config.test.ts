import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../../src/config.js';

describe('resolveConfig', () => {
  it('returns the defaults for non-object input', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig('nonsense')).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig([])).toEqual(DEFAULT_CONFIG);
  });

  it('merges known keys over the base', () => {
    const config = resolveConfig({
      diagnostics: { enable: false, scope: false },
      inlayHints: { enable: true },
      workspaceSymbols: { maxFiles: 50 },
      trace: { server: 'verbose' },
    });
    expect(config.diagnostics).toEqual({ enable: false, scope: false, strictChecks: true, literalTypes: true });
    expect(config.inlayHints).toEqual({ enable: true, capabilities: false });
    expect(config.workspaceSymbols).toEqual({ enable: true, maxFiles: 50 });
    expect(config.trace.server).toBe('verbose');
    expect(config.completion).toEqual(DEFAULT_CONFIG.completion);
  });

  it('falls back on wrong types and ignores unknown keys', () => {
    const config = resolveConfig({
      diagnostics: { enable: 'yes', strictChecks: null, nonsense: 1 },
      workspaceSymbols: { maxFiles: -3 },
      trace: { server: 'loud' },
      unknown: { deeply: true },
    });
    expect(config.diagnostics.enable).toBe(true);
    expect(config.diagnostics.strictChecks).toBe(true);
    expect(config.workspaceSymbols.maxFiles).toBe(DEFAULT_CONFIG.workspaceSymbols.maxFiles);
    expect(config.trace.server).toBe('off');
  });

  it('merges over an explicit base rather than the defaults', () => {
    const base = resolveConfig({ completion: { snippets: false } });
    const config = resolveConfig({ diagnostics: { enable: false } }, base);
    expect(config.completion.snippets).toBe(false);
    expect(config.diagnostics.enable).toBe(false);
  });
});
