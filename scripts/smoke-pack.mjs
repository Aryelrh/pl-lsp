#!/usr/bin/env node
// Phase 7 gate: pack the tarball, install it in a fresh temp project, then run
// `--version`, `--help` and a raw framed JSON-RPC E2E against the installed
// binary (initialize -> didOpen -> E301 diagnostic -> shutdown/exit).
// Requires network: the `placitum` dependency is fetched from its pinned SHA.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'placitum-lsp-smoke-'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const log = (message) => console.log(`smoke-pack: ${message}`);

function run(command, args, cwd = work) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function rawE2E(binPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const messages = [];
    let buffer = Buffer.alloc(0);
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length: (\d+)/.exec(header);
        if (match === null) return reject(new Error(`unframed stdout: ${header}`));
        const length = Number(match[1]);
        if (buffer.length < headerEnd + 4 + length) break;
        const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4 + length);
        messages.push(JSON.parse(body));
      }
    });
    const send = (message) => child.stdin.write(frame(message));
    const waitFor = (predicate, label) =>
      new Promise((res, rej) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const found = messages.find(predicate);
          if (found !== undefined) {
            clearInterval(timer);
            res(found);
          } else if (Date.now() - started > 20000) {
            clearInterval(timer);
            rej(new Error(`timeout waiting for ${label}; stderr: ${stderr}`));
          }
        }, 20);
      });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (buffer.length > 0) return reject(new Error('stdout has trailing bytes outside frames'));
      if (code !== 0) return reject(new Error(`exit code ${code}; stderr: ${stderr}`));
      resolve();
    });

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
    waitFor((message) => message.id === 1, 'initialize')
      .then((response) => {
        if (response.result?.capabilities?.positionEncoding !== 'utf-16') {
          return reject(new Error(`bad initialize result: ${JSON.stringify(response)}`));
        }
        send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        send({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: 'file:///tmp/smoke.placitum',
              languageId: 'placitum',
              version: 1,
              text: 'let config = fs.readFile!("/etc/app.json")\n',
            },
          },
        });
        return waitFor((message) => message.method === 'textDocument/publishDiagnostics', 'diagnostics');
      })
      .then((notification) => {
        const codes = (notification.params?.diagnostics ?? []).map((diagnostic) => diagnostic.code);
        if (!codes.includes('E301_EXTRACT_UNCOVERED_CAPABILITY')) {
          return reject(new Error(`expected E301, got ${JSON.stringify(codes)}`));
        }
        send({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
        return waitFor((message) => message.id === 2, 'shutdown');
      })
      .then(() => {
        send({ jsonrpc: '2.0', method: 'exit' });
      })
      .catch(reject);
  });
}

try {
  log('packing tarball');
  const packed = run('npm', ['pack', '--silent', '--pack-destination', work], root).trim().split('\n').pop();
  const tarball = join(work, packed);
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'smoke', private: true, version: '0.0.0' }, null, 2));
  log('installing tarball in a temp project (fetches the pinned core; may take a while)');
  run('npm', ['install', '--no-audit', '--no-fund', tarball]);
  const bin = join(work, 'node_modules', '.bin', 'placitum-lsp');
  const version = run(bin, ['--version']).trim();
  if (!version.includes(pkg.version)) throw new Error(`--version mismatch: ${version}`);
  log(`--version ok (${version})`);
  if (!run(bin, ['--help']).includes('--stdio')) throw new Error('--help does not mention --stdio');
  log('--help ok');
  await rawE2E(join(work, 'node_modules', 'placitum-lsp', 'dist', 'bin.js'));
  log('raw E2E ok (initialize, E301 diagnostics, shutdown/exit, stdout purity)');
} catch (error) {
  console.error(`smoke-pack: FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
