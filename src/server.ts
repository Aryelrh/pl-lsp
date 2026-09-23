/** Connection wiring: lifecycle, capabilities, document sync, configuration, features. */
import { fileURLToPath } from 'node:url';
import {
  DidChangeWatchedFilesNotification,
  ResponseError,
  TextDocumentSyncKind,
  type ClientCapabilities,
  type Connection,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type LocationLink,
} from 'vscode-languageserver/node.js';
import { DEFAULT_CONFIG, resolveConfig, type PlacitumConfig } from './config.js';
import { Documents } from './documents.js';
import type { Logger } from './log.js';
import type { Analysis } from './analysis/model.js';
import { definitionAt, typeDefinitionAt, type DefinitionTarget } from './features/definition.js';
import { referencesAt } from './features/references.js';
import { prepareRenameAt, renameAt } from './features/rename.js';
import { documentSymbols } from './features/symbols.js';
import { WorkspaceIndex } from './workspace/files.js';
import { VERSION } from './version.js';

export interface ServerOptions {
  log: Logger;
  config?: PlacitumConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function placitumSection(initializationOptions: unknown): unknown {
  return isRecord(initializationOptions) ? initializationOptions['placitum'] : undefined;
}

function initializeResult(): InitializeResult {
  return {
    capabilities: {
      positionEncoding: 'utf-16',
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      definitionProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
    },
    serverInfo: { name: 'placitum-lsp', version: VERSION },
  };
}

function applyTrace(connection: Connection, log: Logger): void {
  // ponytail: the trace setter lives in the library's optional tracer feature;
  // for now `$/setTrace` only adjusts our own stderr logging. Add per-message
  // forwarding when the tracer feature is wired in (directive §7.12).
  connection.onNotification('$/setTrace', (params) => {
    if (params.value === 'off' || params.value === 'messages' || params.value === 'verbose') {
      log.info(`trace level: ${params.value}`);
    }
  });
}

function rootPaths(params: InitializeParams): string[] {
  const folders = params.workspaceFolders;
  const uris = folders !== null && folders !== undefined && folders.length > 0
    ? folders.map((folder) => folder.uri)
    : params.rootUri !== null && params.rootUri !== undefined
      ? [params.rootUri]
      : [];
  const paths: string[] = [];
  for (const uri of uris) {
    try {
      paths.push(fileURLToPath(uri));
    } catch {
      // Non-file URIs have no filesystem scan.
    }
  }
  return paths;
}

/** Never let a feature handler take the connection down; ResponseErrors pass through. */
function respond<T>(log: Logger, label: string, fallback: T, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    log.error(`${label} failed`, error);
    return fallback;
  }
}

function toLocationLink(target: DefinitionTarget): LocationLink {
  return {
    targetUri: target.uri,
    targetRange: target.range,
    targetSelectionRange: target.selectionRange,
    originSelectionRange: target.origin,
  };
}

function toLocation(target: DefinitionTarget): Location {
  return { uri: target.uri, range: target.selectionRange };
}

export function createServer(connection: Connection, options: ServerOptions): void {
  const log = options.log;
  let config = options.config ?? DEFAULT_CONFIG;
  let capabilities: ClientCapabilities | undefined;
  let roots: string[] = [];
  let workspaceIndex: WorkspaceIndex | null = null;
  const documents = new Documents(connection, log, config);
  documents.listen();
  applyTrace(connection, log);

  const applyConfig = (raw: unknown): void => {
    config = resolveConfig(raw, config);
    workspaceIndex = null;
    documents.setConfig(config);
  };

  const analysisAt = (uri: string): Analysis | undefined => documents.analysisFor(uri);

  const pullConfiguration = (): void => {
    if (capabilities?.workspace?.configuration !== true) return;
    void connection.workspace.getConfiguration('placitum').then(
      (value: unknown) => applyConfig(value),
      (error: unknown) => log.error('workspace/configuration failed', error),
    );
  };

  connection.onInitialize((params) => {
    capabilities = params.capabilities;
    roots = rootPaths(params);
    applyConfig(placitumSection(params.initializationOptions));
    log.info(`initialize (client=${params.clientInfo?.name ?? 'unknown'}, roots=${roots.length})`);
    return initializeResult();
  });

  connection.onInitialized(() => {
    pullConfiguration();
    if (capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration === true) {
      void connection.client
        .register(DidChangeWatchedFilesNotification.type, { watchers: [{ globPattern: '**/*.placitum' }] })
        .catch((error: unknown) => log.error('file watcher registration failed', error));
    }
    log.info('initialized');
  });

  connection.onDidChangeConfiguration(() => {
    pullConfiguration();
  });

  connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) workspaceIndex?.invalidate(change.uri);
  });

  connection.onDefinition((params) =>
    respond(log, 'definition', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      const target = definitionAt(analysis, analysis.document.offsetAt(params.position));
      if (target === null) return null;
      return capabilities?.textDocument?.definition?.linkSupport === true ? [toLocationLink(target)] : [toLocation(target)];
    }),
  );

  connection.onTypeDefinition((params) =>
    respond(log, 'typeDefinition', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      const target = typeDefinitionAt(analysis, analysis.document.offsetAt(params.position));
      if (target === null) return null;
      return capabilities?.textDocument?.definition?.linkSupport === true ? [toLocationLink(target)] : [toLocation(target)];
    }),
  );

  connection.onReferences((params) =>
    respond(log, 'references', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return referencesAt(analysis, analysis.document.offsetAt(params.position), params.context.includeDeclaration);
    }),
  );

  connection.onPrepareRename((params) =>
    respond(log, 'prepareRename', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      return prepareRenameAt(analysis, analysis.document.offsetAt(params.position));
    }),
  );

  connection.onRenameRequest((params) =>
    respond(log, 'rename', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      return renameAt(analysis, analysis.document.offsetAt(params.position), params.newName);
    }),
  );

  connection.onDocumentSymbol((params) =>
    respond(log, 'documentSymbol', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      const hierarchical = capabilities?.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport === true;
      return documentSymbols(analysis, hierarchical);
    }),
  );

  connection.onWorkspaceSymbol((params) =>
    respond(log, 'workspaceSymbol', [], () => {
      if (!config.workspaceSymbols.enable) return [];
      if (workspaceIndex === null) workspaceIndex = new WorkspaceIndex(roots, config.workspaceSymbols.maxFiles, log);
      return workspaceIndex.query(params.query);
    }),
  );

  connection.onShutdown(() => {
    log.info('shutdown requested');
  });
}
