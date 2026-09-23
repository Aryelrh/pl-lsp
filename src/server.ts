/** Connection wiring: lifecycle, capabilities, document sync, configuration, features. */
import { fileURLToPath } from 'node:url';
import {
  CodeActionKind,
  DidChangeWatchedFilesNotification,
  MarkupKind,
  MessageType,
  ResponseError,
  ShowMessageNotification,
  TextDocumentSyncKind,
  type ClientCapabilities,
  type CodeAction,
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
import { codeActionsAt } from './features/code-actions.js';
import { codeLenses } from './features/code-lens.js';
import { completeAt } from './features/completion.js';
import { definitionAt, typeDefinitionAt, type DefinitionTarget } from './features/definition.js';
import { computeDiagnostics } from './features/diagnostics.js';
import { foldingRanges } from './features/folding.js';
import { highlightsAt } from './features/highlights.js';
import { hoverAt } from './features/hover.js';
import { inlayHints } from './features/inlay-hints.js';
import { capMessage, manifestPayload, type ManifestPayload } from './features/manifest-command.js';
import { referencesAt } from './features/references.js';
import { prepareRenameAt, renameAt } from './features/rename.js';
import { selectionRanges } from './features/selection.js';
import { semanticTokens, TOKEN_MODIFIERS, TOKEN_TYPES } from './features/semantic-tokens.js';
import { signatureHelpAt } from './features/signature.js';
import { documentSymbols } from './features/symbols.js';
import { WorkspaceIndex } from './workspace/files.js';
import { VERSION } from './version.js';

interface ManifestParams {
  textDocument: { uri: string };
}

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
      completionProvider: { triggerCharacters: ['.', '|', ' '], resolveProvider: false },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      documentHighlightProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix], resolveProvider: false },
      codeLensProvider: { resolveProvider: false },
      inlayHintProvider: { resolveProvider: false },
      executeCommandProvider: {
        commands: ['placitum.showManifest', 'placitum.reanalyze', 'placitum.addNeeds'],
      },
      semanticTokensProvider: {
        legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] },
        full: true,
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

  connection.onCompletion((params) =>
    respond(log, 'completion', null, () => {
      if (!config.completion.enable) return null;
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      const markdown = capabilities?.textDocument?.completion?.completionItem?.documentationFormat?.includes(MarkupKind.Markdown) === true;
      const snippetSupport = capabilities?.textDocument?.completion?.completionItem?.snippetSupport === true;
      return completeAt(analysis, analysis.document.offsetAt(params.position), {
        snippets: config.completion.snippets && snippetSupport,
        markdown,
      });
    }),
  );

  connection.onHover((params) =>
    respond(log, 'hover', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      const info = hoverAt(analysis, analysis.document.offsetAt(params.position));
      if (info === null) return null;
      const markdown = capabilities?.textDocument?.hover?.contentFormat?.includes(MarkupKind.Markdown) === true;
      return {
        contents: markdown ? { kind: MarkupKind.Markdown, value: info.value } : info.value,
        range: info.range,
      };
    }),
  );

  connection.onSignatureHelp((params) =>
    respond(log, 'signatureHelp', null, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return null;
      return signatureHelpAt(analysis, analysis.document.offsetAt(params.position));
    }),
  );

  connection.onDocumentHighlight((params) =>
    respond(log, 'documentHighlight', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return highlightsAt(analysis, analysis.document.offsetAt(params.position));
    }),
  );

  connection.onFoldingRanges((params) =>
    respond(log, 'foldingRange', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return foldingRanges(analysis);
    }),
  );

  connection.onSelectionRanges((params) =>
    respond(log, 'selectionRange', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return selectionRanges(analysis, params.positions);
    }),
  );

  connection.languages.semanticTokens.on((params) =>
    respond(log, 'semanticTokens', { data: [] }, () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return { data: [] };
      return semanticTokens(analysis);
    }),
  );

  connection.onCodeAction((params) =>
    respond(log, 'codeAction', [], () => {
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return codeActionsAt(analysis, params.range, computeDiagnostics(analysis, config));
    }),
  );

  connection.onCodeLens((params) =>
    respond(log, 'codeLens', [], () => {
      if (!config.codeLens.enable) return [];
      const analysis = analysisAt(params.textDocument.uri);
      return analysis === undefined ? [] : codeLenses(analysis);
    }),
  );

  connection.languages.inlayHint.on((params) =>
    respond(log, 'inlayHint', [], () => {
      if (!config.inlayHints.enable) return [];
      const analysis = analysisAt(params.textDocument.uri);
      if (analysis === undefined) return [];
      return inlayHints(analysis, params.range, { capabilities: config.inlayHints.capabilities });
    }),
  );

  connection.onRequest('placitum/manifest', (params: ManifestParams) =>
    respond<ManifestPayload>(
      log,
      'manifest',
      { markdown: 'Document is not open.', manifest: null, diagnostics: [] },
      () => {
        const analysis = analysisAt(params.textDocument.uri);
        if (analysis === undefined) return { markdown: 'Document is not open.', manifest: null, diagnostics: [] };
        return manifestPayload(analysis);
      },
    ),
  );

  connection.onExecuteCommand((params) => {
    const uri = params.arguments?.find((argument): argument is string => typeof argument === 'string');
    if (uri === undefined) return;
    try {
      switch (params.command) {
        case 'placitum.showManifest': {
          const analysis = analysisAt(uri);
          if (analysis === undefined) return;
          const payload = manifestPayload(analysis);
          log.info(`manifest for ${uri}:\n${payload.markdown}`);
          connection.sendNotification(ShowMessageNotification.type, {
            type: MessageType.Info,
            message: capMessage(payload.markdown),
          });
          return;
        }
        case 'placitum.reanalyze':
          documents.reanalyze(uri);
          return;
        case 'placitum.addNeeds': {
          const analysis = analysisAt(uri);
          if (analysis === undefined) return;
          const uncovered = computeDiagnostics(analysis, config).find(
            (diagnostic) => diagnostic.code === 'E301_EXTRACT_UNCOVERED_CAPABILITY',
          );
          if (uncovered === undefined) return;
          const action = codeActionsAt(analysis, uncovered.range, [uncovered]).find(
            (candidate): candidate is CodeAction => 'edit' in candidate,
          );
          if (action?.edit !== undefined) {
            void connection.workspace
              .applyEdit(action.edit)
              .catch((error: unknown) => log.error('applyEdit failed', error));
          }
          return;
        }
        default:
          log.debug(`unhandled command: ${params.command}`);
      }
    } catch (error) {
      log.error(`command ${params.command} failed`, error);
    }
  });

  connection.onShutdown(() => {
    log.info('shutdown requested');
  });
}
