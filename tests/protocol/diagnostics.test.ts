import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PublishDiagnosticsParams } from 'vscode-languageserver/node.js';
import { createTestClient, type TestClient } from './harness.js';
import { expectGolden } from './golden.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

function nextDiagnostics(server: TestClient, uri: string): Promise<PublishDiagnosticsParams> {
  return new Promise((resolve) => {
    const listener = server.connection.onNotification('textDocument/publishDiagnostics', (params) => {
      if (params.uri === uri) {
        listener.dispose();
        resolve(params);
      }
    });
  });
}

function open(server: TestClient, uri: string, text: string, version = 1): Promise<PublishDiagnosticsParams> {
  const pending = nextDiagnostics(server, uri);
  server.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'placitum', version, text },
  });
  return pending;
}

function change(server: TestClient, uri: string, version: number, text: string): Promise<PublishDiagnosticsParams> {
  const pending = nextDiagnostics(server, uri);
  server.connection.sendNotification('textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  });
  return pending;
}

function close(server: TestClient, uri: string): Promise<PublishDiagnosticsParams> {
  const pending = nextDiagnostics(server, uri);
  server.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
  return pending;
}

describe('diagnostics', () => {
  it('publishes the Appendix C E301 shape, clears on fix and on close', async () => {
    const server = createTestClient();
    await server.initialize();
    const uri = 'file:///tmp/uncovered.placitum';

    const published = await open(server, uri, fixture('uncovered.placitum'));
    expectGolden('uncovered', published);

    const fixed = await change(
      server,
      uri,
      2,
      'needs fs.read("/etc/app.json")\nlet config = fs.readFile!("/etc/app.json")\n',
    );
    expect(fixed.diagnostics).toEqual([]);

    const cleared = await close(server, uri);
    expect(cleared.diagnostics).toEqual([]);
    server.dispose();
  });

  it('reports a lex error without losing the protocol', async () => {
    const server = createTestClient();
    await server.initialize();
    const uri = 'file:///tmp/syntax.placitum';
    const published = await open(server, uri, fixture('syntax.placitum'));
    expectGolden('syntax', published);
    server.dispose();
  });

  it('reports a recovered parse error', async () => {
    const server = createTestClient();
    await server.initialize();
    const published = await open(server, 'file:///tmp/unterminated.placitum', fixture('unterminated.placitum'));
    expect(published.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['E203_PARSE_UNTERMINATED_BLOCK']);
    server.dispose();
  });

  it('reports every lexer error in one pass and stays alive', async () => {
    const server = createTestClient();
    await server.initialize();
    const published = await open(server, 'file:///tmp/two.placitum', 'let x = "abc\nlet y = @\n');
    expect(published.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'E101_LEX_UNTERMINATED_STRING',
      'E104_LEX_UNEXPECTED_CHARACTER',
    ]);
    server.dispose();
  });

  it('publishes nothing for clean, empty, comment-only, astral and CRLF files', async () => {
    const server = createTestClient();
    await server.initialize();
    const clean: [string, string][] = [
      ['rosetta', fixture('rosetta.placitum')],
      ['empty', ''],
      ['comments', '# just a comment\n# another comment\n'],
      ['astral', 'let x = "😀"\n'],
      ['crlf', 'needs net("a.com")\r\nlet r = curl!("https://a.com")\r\n'],
    ];
    for (const [name, text] of clean) {
      const published = await open(server, `file:///tmp/${name}.placitum`, text);
      expect(published.diagnostics, name).toEqual([]);
    }
    server.dispose();
  });

  it('maps CRLF offsets to the correct line', async () => {
    const server = createTestClient();
    await server.initialize();
    const published = await open(server, 'file:///tmp/crlf-bad.placitum', 'let x = 1\r\nlet y = fs.readFile!("a")\r\n');
    expect(published.diagnostics).toHaveLength(1);
    expect(published.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 8 },
      end: { line: 1, character: 25 },
    });
    server.dispose();
  });
});
