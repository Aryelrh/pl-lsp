/**
 * Editor recipe lint (directive §13, Phase 6): JSON and Lua are parsed with
 * real tooling; TOML gets a structural check (no TOML parser on this machine).
 * Emacs Lisp has no available tooling — the recipes are reviewed by hand.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const recipe = (path: string): string => fileURLToPath(new URL(`../../editors/${path}`, import.meta.url));
const hasNvim = spawnSync('nvim', ['--version'], { stdio: 'ignore' }).status === 0;

const JSON_RECIPES = [
  'zed/settings.json',
  'sublime/LSP-placitum.sublime-settings',
  'vim/coc-settings.json',
  'kate/lspclient.json',
];

const LUA_RECIPES = ['neovim/init.lua', 'neovim/nvim-lspconfig.lua'];

/** Strip a trailing comment without touching `#` inside quoted values. */
function stripComment(line: string): string {
  let inQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index - 1] !== '\\') inQuote = !inQuote;
    else if (char === '#' && !inQuote) return line.slice(0, index);
  }
  return line;
}

/** Minimal structural check: comments stripped, only sections and key = value. */
function checkToml(source: string): void {
  for (const raw of source.split('\n')) {
    const line = stripComment(raw).trim();
    if (line === '') continue;
    if (/^\[\[?[^\]\s]+\]\]?$/.test(line)) continue;
    if (/^[A-Za-z0-9_.-]+\s*=\s*\S.*$/.test(line)) {
      const value = line.slice(line.indexOf('=') + 1).trim();
      if ((value.match(/"/g)?.length ?? 0) % 2 !== 0) throw new Error(`unbalanced quotes: ${raw}`);
      continue;
    }
    throw new Error(`unrecognized TOML line: ${raw}`);
  }
}

describe('editor recipes', () => {
  it.each(JSON_RECIPES)('parses %s as JSON', (path) => {
    const parsed: unknown = JSON.parse(readFileSync(recipe(path), 'utf8'));
    expect(typeof parsed).toBe('object');
  });

  it('validates the Helix TOML structure', () => {
    const source = readFileSync(recipe('helix/languages.toml'), 'utf8');
    expect(() => checkToml(source)).not.toThrow();
    expect(source).toContain('[language-server.placitum]');
    expect(source).toContain('command = "placitum-lsp"');
  });

  it.skipIf(!hasNvim)('compiles the Lua recipes', () => {
    for (const path of LUA_RECIPES) {
      const full = recipe(path);
      const result = spawnSync(
        'nvim',
        [
          '--headless',
          '-u',
          'NONE',
          '--cmd',
          `lua local f, err = loadfile(${JSON.stringify(full)}); if not f then io.stderr:write("LUA_ERROR " .. tostring(err) .. "\\n"); vim.cmd("cq") end`,
          '-c',
          'qa!',
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      expect(`${result.stderr ?? ''}`).not.toContain('LUA_ERROR');
      expect(result.status).toBe(0);
    }
  });

  it('ships a recipe for every documented client', () => {
    const readme = readFileSync(recipe('README.md'), 'utf8');
    for (const path of [...JSON_RECIPES, ...LUA_RECIPES, 'helix/languages.toml', 'emacs/eglot.el', 'emacs/lsp-mode.el', 'vim/vim-lsp.vim']) {
      expect(readme).toContain(path);
    }
  });
});
