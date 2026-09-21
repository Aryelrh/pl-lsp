/** Open-document map, per-version analysis cache, debounced diagnostics publishing. */
import { TextDocuments, type Connection, type Diagnostic } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Logger } from './log.js';
import type { PlacitumConfig } from './config.js';
import { createAnalysis, type Analysis } from './analysis/model.js';
import { computeDiagnostics } from './features/diagnostics.js';

// ponytail: fixed 80 ms timer, one per URI; move to worker threads only if
// analysis ever exceeds the budget on real files.
const DEBOUNCE_MS = 80;

export class Documents {
  readonly sync: TextDocuments<TextDocument>;
  private readonly analyses = new Map<string, Analysis>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private config: PlacitumConfig;

  constructor(
    private readonly connection: Connection,
    private readonly log: Logger,
    config: PlacitumConfig,
  ) {
    this.config = config;
    this.sync = new TextDocuments(TextDocument);
    this.sync.onDidOpen((event) => this.schedule(event.document.uri));
    this.sync.onDidChangeContent((event) => this.schedule(event.document.uri));
    this.sync.onDidClose((event) => this.close(event.document.uri));
    this.sync.onDidSave((event) => this.analyzeAndPublish(event.document.uri));
  }

  listen(): void {
    this.sync.listen(this.connection);
  }

  /** Cached analysis for an open document, computed on first use. */
  analysisFor(uri: string): Analysis | undefined {
    const cached = this.analyses.get(uri);
    if (cached !== undefined) return cached;
    const document = this.sync.get(uri);
    if (document === undefined) return undefined;
    const analysis = createAnalysis(document);
    this.analyses.set(uri, analysis);
    return analysis;
  }

  /** Force a synchronous re-analysis and publish immediately (configuration changes, commands). */
  reanalyze(uri: string): void {
    this.analyzeAndPublish(uri);
  }

  /** Drop cached state for a file that changed on disk outside the editor. */
  invalidate(uri: string): void {
    this.analyses.delete(uri);
  }

  setConfig(config: PlacitumConfig): void {
    this.config = config;
    for (const uri of this.sync.keys()) this.schedule(uri);
  }

  private schedule(uri: string): void {
    const pending = this.timers.get(uri);
    if (pending !== undefined) clearTimeout(pending);
    this.timers.set(
      uri,
      setTimeout(() => {
        this.timers.delete(uri);
        this.analyzeAndPublish(uri);
      }, DEBOUNCE_MS),
    );
  }

  private close(uri: string): void {
    const pending = this.timers.get(uri);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.timers.delete(uri);
    }
    this.analyses.delete(uri);
    this.publish(uri, [], undefined);
  }

  private analyzeAndPublish(uri: string): void {
    const document = this.sync.get(uri);
    if (document === undefined) return;
    const started = Date.now();
    const analysis = createAnalysis(document);
    this.analyses.set(uri, analysis);
    this.log.debug(`analyzed ${uri} (v${analysis.version}) in ${Date.now() - started}ms`);
    this.publish(uri, computeDiagnostics(analysis, this.config), analysis.version);
  }

  private publish(uri: string, diagnostics: Diagnostic[], version: number | undefined): void {
    try {
      this.connection.sendDiagnostics(version === undefined ? { uri, diagnostics } : { uri, diagnostics, version });
    } catch (error) {
      this.log.error(`failed to publish diagnostics for ${uri}`, error);
    }
  }
}
