import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '../../src/log.js';
import { WorkspaceIndex } from '../../src/workspace/files.js';

function capturingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const logger: Logger = {
    error: (message) => messages.push(message),
    info: (message) => messages.push(message),
    debug: (message) => messages.push(message),
    trace: (message) => messages.push(message),
  };
  return { logger, messages };
}

let root: string;
let messages: string[];
let logger: Logger;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'placitum-lsp-ws-'));
  ({ logger, messages } = capturingLogger());
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function names(index: WorkspaceIndex, query = ''): string[] {
  return index.query(query).map((symbol) => symbol.name);
}

describe('WorkspaceIndex', () => {
  it('scans .placitum files, skipping node_modules and dot-directories', () => {
    write('a.placitum', 'fn alpha() { return 1 }\n');
    write('sub/b.placitum', 'let beta = 1\n');
    write('node_modules/skip.placitum', 'fn hidden() { return 1 }\n');
    write('.git/hidden.placitum', 'fn hidden2() { return 1 }\n');
    write('notes.txt', 'fn not_a_symbol() { return 1 }\n');
    const index = new WorkspaceIndex([root], 2000, logger);
    const symbols = index.query('');
    expect(symbols.map((symbol) => symbol.name)).toEqual(['alpha', 'beta']);
    expect(symbols.map((symbol) => symbol.containerName)).toEqual(['a.placitum', 'sub/b.placitum']);
  });

  it('filters by query and returns everything for an empty query', () => {
    write('a.placitum', 'fn alpha() { return 1 }\nlet beta = 1\n');
    const index = new WorkspaceIndex([root], 2000, logger);
    expect(names(index, 'alp')).toEqual(['alpha']);
    expect(names(index, 'BET')).toEqual(['beta']);
    expect(names(index, 'zzz')).toEqual([]);
  });

  it('caps the scan and logs the cap', () => {
    write('a.placitum', 'fn alpha() { return 1 }\n');
    write('b.placitum', 'fn beta() { return 1 }\n');
    const index = new WorkspaceIndex([root], 1, logger);
    expect(names(index)).toHaveLength(1);
    expect(messages.some((message) => message.includes('capped at 1 files'))).toBe(true);
  });

  it('re-reads after invalidate and honors mtime changes', () => {
    const file = write('a.placitum', 'fn old() { return 1 }\n');
    const uri = pathToFileURL(file).toString();
    const index = new WorkspaceIndex([root], 2000, logger);
    expect(names(index)).toEqual(['old']);

    writeFileSync(file, 'fn updated() { return 1 }\n');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    expect(names(index)).toEqual(['updated']);

    writeFileSync(file, 'fn again() { return 1 }\n');
    index.invalidate(uri);
    expect(names(index)).toEqual(['again']);
  });

  it('returns nothing for missing roots', () => {
    const index = new WorkspaceIndex([join(root, 'nope')], 2000, logger);
    expect(index.query('')).toEqual([]);
  });
});
