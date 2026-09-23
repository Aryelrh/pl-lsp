/**
 * The only module that reads workspace files (directive §3.2): a capped,
 * on-demand scan with an mtime cache. No persistent index — ponytail: rescan
 * per request is fine for the supported file cap; add an index only if a real
 * workspace ever exceeds it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkspaceSymbol } from 'vscode-languageserver/node.js';
import { workspaceSymbolsFromSource } from '../features/symbols.js';
import type { Logger } from '../log.js';

interface CacheEntry {
  mtimeMs: number;
  symbols: WorkspaceSymbol[];
}

function* walkPlacitumFiles(directory: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // .git and all dot-directories
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walkPlacitumFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.placitum')) {
      yield full;
    }
  }
}

export class WorkspaceIndex {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly roots: readonly string[],
    private readonly maxFiles: number,
    private readonly log: Logger,
  ) {}

  query(query: string): WorkspaceSymbol[] {
    const needle = query.toLowerCase();
    const results: WorkspaceSymbol[] = [];
    let scanned = 0;
    for (const root of this.roots) {
      for (const file of walkPlacitumFiles(root)) {
        if (scanned >= this.maxFiles) {
          this.log.info(`workspace symbol scan capped at ${this.maxFiles} files`);
          return results;
        }
        scanned += 1;
        try {
          const uri = pathToFileURL(file).toString();
          const mtimeMs = statSync(file).mtimeMs;
          const cached = this.cache.get(uri);
          const symbols = cached !== undefined && cached.mtimeMs === mtimeMs
            ? cached.symbols
            : this.load(uri, file, mtimeMs, root);
          for (const symbol of symbols) {
            if (needle === '' || symbol.name.toLowerCase().includes(needle)) results.push(symbol);
          }
        } catch (error) {
          this.log.debug(`skipping ${file}: ${String(error)}`);
        }
      }
    }
    return results;
  }

  invalidate(uri: string): void {
    this.cache.delete(uri);
  }

  private load(uri: string, file: string, mtimeMs: number, root: string): WorkspaceSymbol[] {
    const source = readFileSync(file, 'utf8');
    const relativePath = relative(root, file).split(sep).join('/');
    // With several roots, disambiguate same-named files by prefixing the folder.
    const containerName = this.roots.length > 1 ? `${basename(root)}/${relativePath}` : relativePath;
    const symbols = workspaceSymbolsFromSource(uri, source, containerName);
    this.cache.set(uri, { mtimeMs, symbols });
    return symbols;
  }
}
