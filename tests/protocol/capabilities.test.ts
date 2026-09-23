import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ApplyWorkspaceEditParams,
  CodeAction,
  CodeLens,
  Command,
  InlayHint,
  ShowMessageParams,
  WorkspaceEdit,
} from 'vscode-languageserver/node.js';
import { createTestClient, type TestClient } from './harness.js';
import { expectGolden } from './golden.js';

const URI = 'file:///tmp/cap.placitum';
const rosetta = readFileSync(new URL('../fixtures/rosetta.placitum', import.meta.url), 'utf8');
const uncovered = readFileSync(new URL('../fixtures/uncovered.placitum', import.meta.url), 'utf8');

function open(server: TestClient, text: string, uri = URI): void {
  server.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'placitum', version: 1, text },
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('capability UX capabilities', () => {
  it('advertises code actions, code lens, inlay hints and commands', async () => {
    const server = createTestClient();
    const result = await server.initialize();
    expect(result.capabilities.codeActionProvider).toEqual({ codeActionKinds: ['quickfix'], resolveProvider: false });
    expect(result.capabilities.codeLensProvider).toEqual({ resolveProvider: false });
    expect(result.capabilities.inlayHintProvider).toEqual({ resolveProvider: false });
    expect(result.capabilities.executeCommandProvider).toEqual({
      commands: ['placitum.showManifest', 'placitum.reanalyze', 'placitum.addNeeds'],
    });
    server.dispose();
  });
});

describe('capability UX over the protocol', () => {
  it('answers code actions with the add-needs quick fix', async () => {
    const server = createTestClient();
    await server.initialize();
    open(server, uncovered);
    const actions = (await server.connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri: URI },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 42 } },
      context: { diagnostics: [] },
    })) as (CodeAction | Command)[];
    const fix = actions.find((action) => action.title === 'Add needs fs.read("/etc/app.json")') as CodeAction | undefined;
    expect(fix?.isPreferred).toBe(true);
    expect(fix?.edit?.changes?.[URI]?.[0]?.newText).toBe('needs fs.read("/etc/app.json")\n');
    expect(actions.some((action) => 'command' in action && action.command === 'placitum.showManifest')).toBe(true);
    server.dispose();
  });

  it('answers code lens for the rosetta fixture', async () => {
    const server = createTestClient();
    await server.initialize();
    open(server, rosetta);
    const lenses = (await server.connection.sendRequest('textDocument/codeLens', {
      textDocument: { uri: URI },
    })) as CodeLens[];
    expect(lenses.map((lens) => lens.command?.title)).toEqual([
      '4 grants · 0 deferred — show manifest',
      'needs only(fs.read("/etc/**"))',
    ]);
    server.dispose();
  });

  it('honors the inlay hints config', async () => {
    const disabled = createTestClient();
    await disabled.initialize();
    open(disabled, 'let x = 1\n');
    const none = (await disabled.connection.sendRequest('textDocument/inlayHint', {
      textDocument: { uri: URI },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
    })) as InlayHint[];
    expect(none).toEqual([]);
    disabled.dispose();

    const enabled = createTestClient();
    await enabled.initialize({}, { placitum: { inlayHints: { enable: true } } });
    open(enabled, 'let x = 1\n');
    const hints = (await enabled.connection.sendRequest('textDocument/inlayHint', {
      textDocument: { uri: URI },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
    })) as InlayHint[];
    expect(hints.map((hint) => hint.label)).toEqual([': number']);
    enabled.dispose();
  });

  it('serves placitum/manifest with the core explain markdown (golden)', async () => {
    const server = createTestClient();
    await server.initialize();
    open(server, rosetta);
    const payload = await server.connection.sendRequest('placitum/manifest', { textDocument: { uri: URI } });
    expectGolden('manifest-rosetta', payload);
    server.dispose();
  });

  it('runs placitum.showManifest and placitum.reanalyze', async () => {
    const server = createTestClient();
    await server.initialize();
    const messages: ShowMessageParams[] = [];
    server.connection.onNotification('window/showMessage', (params: ShowMessageParams) => messages.push(params));
    open(server, rosetta);
    await server.connection.sendRequest('workspace/executeCommand', {
      command: 'placitum.showManifest',
      arguments: [URI],
    });
    await waitUntil(() => messages.length > 0);
    expect(messages[0]?.message).toContain('grants (statically proven):');

    let publishes = 0;
    server.connection.onNotification('textDocument/publishDiagnostics', () => {
      publishes += 1;
    });
    await server.connection.sendRequest('workspace/executeCommand', {
      command: 'placitum.reanalyze',
      arguments: [URI],
    });
    await waitUntil(() => publishes > 0);
    server.dispose();
  });

  it('resolves commands without arguments to the only open document', async () => {
    const server = createTestClient();
    await server.initialize();
    const messages: ShowMessageParams[] = [];
    server.connection.onNotification('window/showMessage', (params: ShowMessageParams) => messages.push(params));
    open(server, rosetta);
    await server.connection.sendRequest('workspace/executeCommand', { command: 'placitum.showManifest' });
    await waitUntil(() => messages.length > 0);
    expect(messages[0]?.message).toContain('grants (statically proven):');
    server.dispose();
  });

  it('applies the add-needs edit for placitum.addNeeds', async () => {
    const server = createTestClient();
    await server.initialize();
    let captured: WorkspaceEdit | undefined;
    server.connection.onRequest('workspace/applyEdit', (params: ApplyWorkspaceEditParams) => {
      captured = params.edit;
      return { applied: true };
    });
    open(server, uncovered);
    await server.connection.sendRequest('workspace/executeCommand', {
      command: 'placitum.addNeeds',
      arguments: [URI],
    });
    await waitUntil(() => captured !== undefined);
    expect(captured?.changes?.[URI]?.[0]?.newText).toBe('needs fs.read("/etc/app.json")\n');
    server.dispose();
  });
});

describe('manifest payload for a broken file', () => {
  it('lists diagnostics instead of the manifest', async () => {
    const server = createTestClient();
    await server.initialize();
    open(server, 'let x = "abc\n');
    const payload = (await server.connection.sendRequest('placitum/manifest', {
      textDocument: { uri: URI },
    })) as { markdown: string; manifest: unknown };
    expect(payload.manifest).toBeNull();
    expect(payload.markdown).toContain('E101_LEX_UNTERMINATED_STRING');
    server.dispose();
  });
});
