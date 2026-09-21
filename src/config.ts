/** Settings resolution (workspace/configuration + initializationOptions); defensive parsing. */
export type TraceLevel = 'off' | 'messages' | 'verbose';

export interface PlacitumConfig {
  diagnostics: {
    enable: boolean;
    scope: boolean;
    strictChecks: boolean;
    literalTypes: boolean;
  };
  completion: {
    enable: boolean;
    snippets: boolean;
  };
  codeLens: {
    enable: boolean;
  };
  inlayHints: {
    enable: boolean;
    capabilities: boolean;
  };
  workspaceSymbols: {
    enable: boolean;
    maxFiles: number;
  };
  trace: {
    server: TraceLevel;
  };
}

export const DEFAULT_CONFIG: PlacitumConfig = {
  diagnostics: { enable: true, scope: true, strictChecks: true, literalTypes: true },
  completion: { enable: true, snippets: true },
  codeLens: { enable: true },
  inlayHints: { enable: false, capabilities: false },
  workspaceSymbols: { enable: true, maxFiles: 2000 },
  trace: { server: 'off' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function traceLevel(value: unknown, fallback: TraceLevel): TraceLevel {
  return value === 'off' || value === 'messages' || value === 'verbose' ? value : fallback;
}

/** Merge raw client settings over `base`; unknown keys and wrong types fall back. */
export function resolveConfig(raw: unknown, base: PlacitumConfig = DEFAULT_CONFIG): PlacitumConfig {
  const source = isRecord(raw) ? raw : {};
  const diagnostics = section(source, 'diagnostics');
  const completion = section(source, 'completion');
  const codeLens = section(source, 'codeLens');
  const inlayHints = section(source, 'inlayHints');
  const workspaceSymbols = section(source, 'workspaceSymbols');
  const trace = section(source, 'trace');
  return {
    diagnostics: {
      enable: bool(diagnostics['enable'], base.diagnostics.enable),
      scope: bool(diagnostics['scope'], base.diagnostics.scope),
      strictChecks: bool(diagnostics['strictChecks'], base.diagnostics.strictChecks),
      literalTypes: bool(diagnostics['literalTypes'], base.diagnostics.literalTypes),
    },
    completion: {
      enable: bool(completion['enable'], base.completion.enable),
      snippets: bool(completion['snippets'], base.completion.snippets),
    },
    codeLens: {
      enable: bool(codeLens['enable'], base.codeLens.enable),
    },
    inlayHints: {
      enable: bool(inlayHints['enable'], base.inlayHints.enable),
      capabilities: bool(inlayHints['capabilities'], base.inlayHints.capabilities),
    },
    workspaceSymbols: {
      enable: bool(workspaceSymbols['enable'], base.workspaceSymbols.enable),
      maxFiles: positiveInt(workspaceSymbols['maxFiles'], base.workspaceSymbols.maxFiles),
    },
    trace: {
      server: traceLevel(trace['server'], base.trace.server),
    },
  };
}
