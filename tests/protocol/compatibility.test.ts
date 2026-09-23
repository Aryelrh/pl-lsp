/**
 * Compatibility hardening (directive §13, Phase 6): minimal clients, degraded
 * capabilities, and the UTF-16 contract. Everything here runs in-process.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import type {
  CompletionItem,
  Diagnostic,
  FullDocumentDiagnosticReport,
  Hover,
  PublishDiagnosticsParams,
  SymbolInformation,
  WorkspaceSymbol,
} from 'vscode-languageserver/node.js';
import { createTestClient, type TestClient } from './harness.js';

const URI = 'file:///tmp/compat.placitum';
const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');

function open(server: TestClient, text: string, uri = URI): void {
  server.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'placitum', version: 1, text },
  });
}

function positionOf(text: string, offset: number) {
  return TextDocument.create(URI, 'placitum', 1, text).positionAt(offset);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('minimal clients', () => {
  it('serves flat symbols and plaintext hover with no client capabilities', async () => {
    const server = createTestClient();
    await server.initialize({});
    open(server, rosetta);
    const symbols = (await server.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: URI },
    })) as SymbolInformation[];
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every((symbol) => !('children' in symbol))).toBe(true);
    expect(symbols.find((symbol) => symbol.name === 'load')?.containerName).toBeUndefined();
    expect(symbols.find((symbol) => symbol.name === 'data')?.containerName).toBe('load');

    open(server, 'let cfg = 1\n', 'file:///tmp/compat-hover.placitum');
    const hover = (await server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: 'file:///tmp/compat-hover.placitum' },
      position: positionOf('let cfg = 1\n', 5),
    })) as Hover;
    expect(typeof hover.contents).toBe('string');
    server.dispose();
  });

  it('serves plain-text completion without snippetSupport', async () => {
    const server = createTestClient();
    await server.initialize({});
    const source = 'let config = 1\nlet c\n';
    open(server, source);
    const items = (await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: URI },
      position: positionOf(source, 20),
    })) as CompletionItem[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.insertTextFormat === 2)).toBe(false);
    expect(items.find((item) => item.label === 'config')?.textEdit?.newText).toBe('config');
    server.dispose();
  });

  it('does not send client/registerCapability when dynamic registration is unsupported', async () => {
    const server = createTestClient();
    const registrations: unknown[] = [];
    server.connection.onRequest('client/registerCapability', (params: unknown) => {
      registrations.push(params);
      return null;
    });
    await server.initialize({});
    open(server, rosetta);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registrations).toEqual([]);
    server.dispose();
  });

  it('registers the watched-file watcher only when the client supports it', async () => {
    const server = createTestClient();
    const registrations: unknown[] = [];
    server.connection.onRequest('client/registerCapability', (params: unknown) => {
      registrations.push(params);
      return null;
    });
    await server.initialize({ workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } });
    await waitUntil(() => registrations.length > 0);
    expect(registrations[0]).toMatchObject({
      registrations: [
        { method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [{ globPattern: '**/*.placitum' }] } },
      ],
    });
    server.dispose();
  });

  it('returns no workspace symbols without a root', async () => {
    const server = createTestClient();
    await server.initialize({}, undefined, null);
    const symbols = (await server.connection.sendRequest('workspace/symbol', { query: '' })) as WorkspaceSymbol[];
    expect(symbols).toEqual([]);
    server.dispose();
  });

  it('uses initializationOptions and never asks for workspace/configuration when unsupported', async () => {
    const server = createTestClient();
    const configurationRequests: unknown[] = [];
    server.connection.onRequest('workspace/configuration', (params: unknown) => {
      configurationRequests.push(params);
      return [null];
    });
    const published: Diagnostic[][] = [];
    server.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      published.push(params.diagnostics);
    });
    await server.initialize({}, { placitum: { diagnostics: { enable: false } } });
    open(server, 'let config = fs.readFile!("/etc/app.json")\n');
    await waitUntil(() => published.length > 0);
    expect(configurationRequests).toEqual([]);
    expect(published[0]).toEqual([]);
    server.dispose();
  });

  it('pulls configuration when the client supports workspace/configuration', async () => {
    const server = createTestClient();
    const configurationRequests: unknown[] = [];
    server.connection.onRequest('workspace/configuration', (params: unknown) => {
      configurationRequests.push(params);
      return [{ diagnostics: { enable: false } }];
    });
    await server.initialize({ workspace: { configuration: true } });
    await waitUntil(() => configurationRequests.length > 0);
    expect(configurationRequests[0]).toMatchObject({ items: [{ section: 'placitum' }] });
    server.dispose();
  });
});

describe('pull diagnostics', () => {
  it('advertises the provider only to pull-capable clients', async () => {
    const pushOnly = createTestClient();
    const pushResult = await pushOnly.initialize({});
    expect(pushResult.capabilities.diagnosticProvider).toBeUndefined();
    pushOnly.dispose();

    const server = createTestClient();
    const result = await server.initialize({ textDocument: { diagnostic: {} } });
    expect(result.capabilities.diagnosticProvider).toEqual({
      interFileDependencies: false,
      workspaceDiagnostics: false,
    });
    server.dispose();
  });

  it('serves full/unchanged reports and refreshes after a change', async () => {
    const server = createTestClient();
    await server.initialize({ textDocument: { diagnostic: {} } });
    open(server, 'let config = fs.readFile!("/etc/app.json")\n');
    const full = (await server.connection.sendRequest('textDocument/diagnostic', {
      textDocument: { uri: URI },
    })) as FullDocumentDiagnosticReport;
    expect(full.kind).toBe('full');
    expect(full.items.map((diagnostic) => diagnostic.code)).toEqual(['E301_EXTRACT_UNCOVERED_CAPABILITY']);
    expect(full.resultId).toBeDefined();

    const unchanged = await server.connection.sendRequest('textDocument/diagnostic', {
      textDocument: { uri: URI },
      previousResultId: full.resultId,
    });
    expect(unchanged).toEqual({ kind: 'unchanged', resultId: full.resultId });

    server.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: URI, version: 2 },
      contentChanges: [{ text: 'let x = 1\n' }],
    });
    const changed = (await server.connection.sendRequest('textDocument/diagnostic', {
      textDocument: { uri: URI },
      previousResultId: full.resultId,
    })) as FullDocumentDiagnosticReport;
    expect(changed.kind).toBe('full');
    expect(changed.items).toEqual([]);
    expect(changed.resultId).not.toBe(full.resultId);
    server.dispose();
  });
});

describe('multi-root workspace symbols', () => {
  it('rescans when folders are added and prefixes container names', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'placitum-lsp-root-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'placitum-lsp-root-b-'));
    try {
      writeFileSync(join(dirA, 'a.placitum'), 'fn alpha() { return 1 }\n');
      writeFileSync(join(dirB, 'b.placitum'), 'fn beta() { return 1 }\n');
      const server = createTestClient();
      await server.initialize({}, undefined, pathToFileURL(dirA).toString());
      const before = (await server.connection.sendRequest('workspace/symbol', { query: '' })) as WorkspaceSymbol[];
      expect(before.map((symbol) => symbol.name)).toEqual(['alpha']);
      expect(before[0]?.containerName).toBe('a.placitum');

      server.connection.sendNotification('workspace/didChangeWorkspaceFolders', {
        event: { added: [{ uri: pathToFileURL(dirB).toString(), name: 'b' }], removed: [] },
      });
      const after = (await server.connection.sendRequest('workspace/symbol', { query: '' })) as WorkspaceSymbol[];
      expect(after.map((symbol) => symbol.name)).toEqual(['alpha', 'beta']);
      expect(after[0]?.containerName?.endsWith('/a.placitum')).toBe(true);
      expect(after[1]?.containerName?.endsWith('/b.placitum')).toBe(true);
      server.dispose();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

describe('UTF-16 position contract', () => {
  it('counts astral characters as surrogate pairs in diagnostic ranges', async () => {
    const server = createTestClient();
    await server.initialize({});
    const published: Diagnostic[] = [];
    server.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      published.push(...params.diagnostics);
    });
    open(server, 'let x = "😀" + missing\n');
    await waitUntil(() => published.length > 0);
    const unbound = published.find((diagnostic) => diagnostic.code === 'E500_EVAL_UNBOUND_VAR');
    expect(unbound?.range).toEqual({ start: { line: 0, character: 15 }, end: { line: 0, character: 22 } });
    server.dispose();
  });
});
