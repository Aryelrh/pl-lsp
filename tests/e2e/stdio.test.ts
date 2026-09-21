import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

const BIN = new URL('../../dist/bin.js', import.meta.url);

beforeAll(() => {
  if (!existsSync(BIN)) {
    throw new Error('dist/bin.js is missing; run `npm run build` before the e2e tests.');
  }
});

interface RpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

/** Incremental parser for Content-Length framed JSON-RPC over a byte stream. */
class FrameParser {
  private buffer = Buffer.alloc(0);
  private parseError: Error | null = null;

  push(chunk: Buffer): RpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: RpcMessage[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /^Content-Length: (\d+)$/im.exec(header);
      if (match === null || match[1] === undefined) {
        this.parseError = new Error(`non-framed stdout: ${header}`);
        break;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      messages.push(JSON.parse(body) as RpcMessage);
      this.buffer = this.buffer.subarray(bodyStart + length);
    }
    return messages;
  }

  error(): Error | null {
    return this.parseError;
  }

  get remainder(): Buffer {
    return this.buffer;
  }
}

interface Session {
  child: ChildProcess;
  messages: RpcMessage[];
  parser: FrameParser;
  stderr: string;
}

const sessions: Session[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) {
    if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill();
  }
});

function start(): Session {
  const child = spawn(process.execPath, [BIN.pathname, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const session: Session = { child, messages: [], parser: new FrameParser(), stderr: '' };
  child.stdout?.on('data', (chunk: Buffer) => {
    session.messages.push(...session.parser.push(chunk));
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    session.stderr += chunk.toString();
  });
  sessions.push(session);
  return session;
}

function send(session: Session, message: unknown): void {
  const body = JSON.stringify(message);
  session.child.stdin?.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

async function waitFor(
  session: Session,
  predicate: (message: RpcMessage) => boolean,
  timeoutMs = 5000,
): Promise<RpcMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = session.messages.find(predicate);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for a message; got ${JSON.stringify(session.messages)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(session: Session, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for server exit')), timeoutMs);
    session.child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('stdio server', () => {
  it('runs a full session with pure stdout framing and exit code 0', async () => {
    const session = start();
    send(session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { processId: null, rootUri: null, capabilities: {} },
    });
    const initialized = await waitFor(session, (message) => message.id === 1);
    const result = initialized.result as { capabilities: { positionEncoding: string } };
    expect(result.capabilities.positionEncoding).toBe('utf-16');

    send(session, { jsonrpc: '2.0', method: 'initialized', params: {} });
    send(session, {
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///tmp/e2e.placitum',
          languageId: 'placitum',
          version: 1,
          text: 'let config = fs.readFile!("/etc/app.json")',
        },
      },
    });
    const published = await waitFor(session, (message) => message.method === 'textDocument/publishDiagnostics');
    const params = published.params as { diagnostics: { code?: unknown }[] };
    expect(params.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['E301_EXTRACT_UNCOVERED_CAPABILITY']);

    send(session, { jsonrpc: '2.0', id: 2, method: 'shutdown' });
    await waitFor(session, (message) => message.id === 2);
    send(session, { jsonrpc: '2.0', method: 'exit' });

    const code = await waitForExit(session);
    expect(code).toBe(0);
    expect(session.parser.error()).toBeNull();
    expect(session.parser.remainder.length).toBe(0);
    expect(session.messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
    expect(session.stderr).toContain('placitum-lsp');
  });

  it('prints --version and --help on stdout', () => {
    const version = spawnSync(process.execPath, [BIN.pathname, '--version'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(`placitum-lsp ${VERSION}`);
    expect(version.stderr).toBe('');

    const help = spawnSync(process.execPath, [BIN.pathname, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: placitum-lsp');
    expect(help.stderr).toBe('');
  });

  it('rejects non-stdio transports loudly', () => {
    const result = spawnSync(process.execPath, [BIN.pathname, '--node-ipc'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('only --stdio is supported');
  });
});
