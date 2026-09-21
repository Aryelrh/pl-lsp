/** Connection wiring: lifecycle, capabilities, document sync, configuration. */
import {
  TextDocumentSyncKind,
  type Connection,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { DEFAULT_CONFIG, resolveConfig, type PlacitumConfig } from './config.js';
import { Documents } from './documents.js';
import type { Logger } from './log.js';
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

export function createServer(connection: Connection, options: ServerOptions): void {
  const log = options.log;
  let config = options.config ?? DEFAULT_CONFIG;
  let supportsConfiguration = false;
  const documents = new Documents(connection, log, config);
  documents.listen();
  applyTrace(connection, log);

  const applyConfig = (raw: unknown): void => {
    config = resolveConfig(raw, config);
    documents.setConfig(config);
  };

  const pullConfiguration = (): void => {
    if (!supportsConfiguration) return;
    void connection.workspace.getConfiguration('placitum').then(
      (value: unknown) => applyConfig(value),
      (error: unknown) => log.error('workspace/configuration failed', error),
    );
  };

  connection.onInitialize((params) => {
    supportsConfiguration = params.capabilities.workspace?.configuration === true;
    applyConfig(placitumSection(params.initializationOptions));
    log.info(`initialize (client=${params.clientInfo?.name ?? 'unknown'})`);
    return initializeResult();
  });

  connection.onInitialized(() => {
    pullConfiguration();
    log.info('initialized');
  });

  connection.onDidChangeConfiguration(() => {
    pullConfiguration();
  });

  connection.onShutdown(() => {
    log.info('shutdown requested');
  });
}
