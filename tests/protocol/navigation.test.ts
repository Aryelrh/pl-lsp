import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocumentSymbol, Location, LocationLink, SymbolInformation, WorkspaceEdit, WorkspaceSymbol } from 'vscode-languageserver/node.js';
import { createTestClient, type TestClient } from './harness.js';

const URI = 'file:///tmp/nav.placitum';
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'placitum-lsp-nav-'));
  tempDirs.push(dir);
  return dir;
}

function open(server: TestClient, text: string, uri = URI): void {
  server.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'placitum', version: 1, text },
  });
}

function positionOf(text: string, offset: number) {
  return TextDocument.create(URI, 'placitum', 1, text).positionAt(offset);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('navigation over the protocol', () => {
  const source = 'let config = 1\nprint!(config)\n';

  it('answers definition with LocationLink or Location per capability', async () => {
    const linkServer = createTestClient();
    await linkServer.initialize({ textDocument: { definition: { linkSupport: true } } });
    open(linkServer, source);
    const links = (await linkServer.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: URI },
      position: positionOf(source, source.lastIndexOf('config')),
    })) as LocationLink[];
    expect(links[0]?.targetUri).toBe(URI);
    expect(links[0]?.targetSelectionRange).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 10 } });
    linkServer.dispose();

    const plainServer = createTestClient();
    await plainServer.initialize();
    open(plainServer, source);
    const locations = (await plainServer.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: URI },
      position: positionOf(source, source.lastIndexOf('config')),
    })) as Location[];
    expect(locations[0]?.uri).toBe(URI);
    expect(locations[0]?.range.start.line).toBe(0);
    plainServer.dispose();
  });

  it('answers type definition and references', async () => {
    const server = createTestClient();
    await server.initialize();
    const text = 'let x = 1\nx = 2\nlet y = x\n';
    open(server, text);
    const typeDef = (await server.connection.sendRequest('textDocument/typeDefinition', {
      textDocument: { uri: URI },
      position: positionOf(text, text.lastIndexOf('x')),
    })) as Location[];
    expect(typeDef[0]?.range.start.line).toBe(0);
    const references = (await server.connection.sendRequest('textDocument/references', {
      textDocument: { uri: URI },
      position: positionOf(text, 4),
      context: { includeDeclaration: true },
    })) as Location[];
    expect(references.map((location) => location.range.start.line)).toEqual([0, 1, 2]);
    server.dispose();
  });

  it('prepares and applies a scope-aware rename', async () => {
    const server = createTestClient();
    await server.initialize();
    const shadowed = 'let x = 1\nfn f(x) {\n  return x\n}\nlet y = x\n';
    open(server, shadowed);
    const position = positionOf(shadowed, shadowed.indexOf('fn f(x)') + 'fn f('.length);
    const prepared = (await server.connection.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: URI },
      position,
    })) as { range: { start: { line: number } }; placeholder: string };
    expect(prepared.placeholder).toBe('x');
    expect(prepared.range.start.line).toBe(1);
    const edit = (await server.connection.sendRequest('textDocument/rename', {
      textDocument: { uri: URI },
      position,
      newName: 'z',
    })) as WorkspaceEdit;
    expect(edit.changes?.[URI]).toHaveLength(2);
    server.dispose();
  });

  it('rejects renaming a builtin with a clear ResponseError', async () => {
    const server = createTestClient();
    await server.initialize();
    const builtin = 'let y = json\n';
    open(server, builtin);
    await expect(
      server.connection.sendRequest('textDocument/prepareRename', {
        textDocument: { uri: URI },
        position: positionOf(builtin, builtin.lastIndexOf('json')),
      }),
    ).rejects.toMatchObject({ code: -32602 });
    server.dispose();
  });

  it('answers hierarchical and flat document symbols', async () => {
    const text = 'needs net("a.com")\nfn f(a) {\n  return a\n}\n';
    const hierarchical = createTestClient();
    await hierarchical.initialize({ textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } });
    open(hierarchical, text);
    const tree = (await hierarchical.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: URI },
    })) as DocumentSymbol[];
    expect(tree.map((symbol) => symbol.name)).toEqual(['needs', 'f']);
    expect(tree[1]?.children?.map((symbol) => symbol.name)).toEqual(['a']);
    hierarchical.dispose();

    const flat = createTestClient();
    await flat.initialize();
    open(flat, text);
    const symbols = (await flat.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: URI },
    })) as SymbolInformation[];
    expect(symbols.map((symbol) => symbol.name)).toContain('f');
    flat.dispose();
  });

  it('registers a file watcher when the client supports it and invalidates the cache', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.placitum');
    writeFileSync(file, 'fn alpha() { return 1 }\n');
    const uri = pathToFileURL(file).toString();

    const server = createTestClient();
    const registrations: unknown[] = [];
    server.connection.onRequest('client/registerCapability', (params) => {
      registrations.push(params);
      return null;
    });
    await server.initialize({ workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } }, undefined, pathToFileURL(dir).toString());
    await waitUntil(() => registrations.length > 0);
    expect(JSON.stringify(registrations[0])).toContain('workspace/didChangeWatchedFiles');

    const first = (await server.connection.sendRequest('workspace/symbol', { query: '' })) as WorkspaceSymbol[];
    expect(first.map((symbol) => symbol.name)).toEqual(['alpha']);
    expect(first[0]?.containerName).toBe('a.placitum');

    writeFileSync(file, 'fn beta() { return 1 }\n');
    server.connection.sendNotification('workspace/didChangeWatchedFiles', { changes: [{ uri, type: 2 }] });
    const second = (await server.connection.sendRequest('workspace/symbol', { query: 'beta' })) as WorkspaceSymbol[];
    expect(second.map((symbol) => symbol.name)).toEqual(['beta']);
    server.dispose();
  });

  it('returns no workspace symbols without roots', async () => {
    const server = createTestClient();
    await server.initialize();
    const symbols = (await server.connection.sendRequest('workspace/symbol', { query: '' })) as WorkspaceSymbol[];
    expect(symbols).toEqual([]);
    server.dispose();
  });
});
