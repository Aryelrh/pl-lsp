import { readFileSync } from 'node:fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import type {
  CompletionItem,
  DocumentHighlight,
  FoldingRange,
  Hover,
  SemanticTokens,
  SelectionRange,
  SignatureHelp,
} from 'vscode-languageserver/node.js';
import { createTestClient, type TestClient } from './harness.js';
import { expectGolden } from './golden.js';

const URI = 'file:///tmp/intel.placitum';
const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');
const tokensFixture = readFileSync(new URL('../fixtures/tokens.placitum', import.meta.url), 'utf8');

function open(server: TestClient, text: string, uri = URI): void {
  server.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'placitum', version: 1, text },
  });
}

function positionOf(text: string, offset: number) {
  return TextDocument.create(URI, 'placitum', 1, text).positionAt(offset);
}

describe('intelligence capabilities', () => {
  it('advertises completion, hover, signature help, highlights, folding, selection and semantic tokens', async () => {
    const server = createTestClient();
    const result = await server.initialize();
    expect(result.capabilities.completionProvider).toEqual({ triggerCharacters: ['.', '|', ' '], resolveProvider: false });
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.signatureHelpProvider).toEqual({ triggerCharacters: ['(', ','] });
    expect(result.capabilities.documentHighlightProvider).toBe(true);
    expect(result.capabilities.foldingRangeProvider).toBe(true);
    expect(result.capabilities.selectionRangeProvider).toBe(true);
    expect(result.capabilities.semanticTokensProvider).toMatchObject({ full: true });
    expect(result.capabilities.semanticTokensProvider).toHaveProperty('legend.tokenTypes');
    server.dispose();
  });
});

describe('intelligence over the protocol', () => {
  it('answers completion with snippets and text edits', async () => {
    const server = createTestClient();
    await server.initialize({
      textDocument: { completion: { completionItem: { documentationFormat: ['markdown'], snippetSupport: true } } },
    });
    const source = 'fn load(path) { return path }\nlet cfg = 1\nlet c';
    open(server, source);
    const items = (await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: URI },
      position: positionOf(source, source.length),
    })) as CompletionItem[];
    const load = items.find((item) => item.label === 'load');
    expect(load?.insertTextFormat).toBe(2);
    expect(load?.textEdit).toBeDefined();
    const effectful = items.find((item) => item.label === 'fs.readFile');
    expect(effectful?.documentation).toMatchObject({ kind: 'markdown' });
    server.dispose();
  });

  it('answers hover as markdown or plain text per capability', async () => {
    const markdown = createTestClient();
    await markdown.initialize({ textDocument: { hover: { contentFormat: ['markdown'] } } });
    open(markdown, 'let cfg = 1\n');
    const rich = (await markdown.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: URI },
      position: positionOf('let cfg = 1\n', 5),
    })) as Hover;
    expect(rich.contents).toMatchObject({ kind: 'markdown' });
    markdown.dispose();

    const plain = createTestClient();
    await plain.initialize();
    open(plain, 'let cfg = 1\n');
    const bare = (await plain.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: URI },
      position: positionOf('let cfg = 1\n', 5),
    })) as Hover;
    expect(typeof bare.contents).toBe('string');
    plain.dispose();
  });

  it('answers signature help, highlights, folding and selection ranges', async () => {
    const server = createTestClient();
    await server.initialize();
    const source = 'fn f(a, b) { return a }\nf(1, ';
    open(server, source);
    const signature = (await server.connection.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri: URI },
      position: positionOf(source, source.length),
    })) as SignatureHelp;
    expect(signature.signatures[0]?.label).toBe('fn f(a, b)');
    expect(signature.activeParameter).toBe(1);

    const highlightSource = 'let x = 1\nx = 2\nlet y = x\n';
    open(server, highlightSource, 'file:///tmp/highlight.placitum');
    const highlights = (await server.connection.sendRequest('textDocument/documentHighlight', {
      textDocument: { uri: 'file:///tmp/highlight.placitum' },
      position: positionOf(highlightSource, 4),
    })) as DocumentHighlight[];
    expect(highlights.map((highlight) => highlight.kind)).toEqual([3, 2]);

    open(server, rosetta, 'file:///tmp/fold.placitum');
    const folding = (await server.connection.sendRequest('textDocument/foldingRange', {
      textDocument: { uri: 'file:///tmp/fold.placitum' },
    })) as FoldingRange[];
    expect(folding.length).toBeGreaterThan(0);

    const selection = (await server.connection.sendRequest('textDocument/selectionRange', {
      textDocument: { uri: 'file:///tmp/fold.placitum' },
      positions: [positionOf(rosetta, rosetta.indexOf('cfg'))],
    })) as SelectionRange[];
    expect(selection).toHaveLength(1);
    expect(selection[0]?.parent).toBeDefined();
    server.dispose();
  });

  it('publishes full semantic tokens (golden)', async () => {
    const server = createTestClient();
    await server.initialize();
    open(server, tokensFixture, 'file:///tmp/tokens.placitum');
    const tokens = (await server.connection.sendRequest('textDocument/semanticTokens/full', {
      textDocument: { uri: 'file:///tmp/tokens.placitum' },
    })) as SemanticTokens;
    expect(tokens.data.length).toBeGreaterThan(0);
    expectGolden('semantic-tokens', tokens);
    server.dispose();
  });
});
