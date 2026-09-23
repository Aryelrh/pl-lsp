import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = new URL('../../dist/bin.js', import.meta.url);
const hasNvim = spawnSync('nvim', ['--version'], { stdio: 'ignore' }).status === 0;

const RENAME_SCRIPT = `
vim.cmd("edit " .. vim.env.PLACITUM_FILE)
local id = vim.lsp.start({
  name = "placitum",
  cmd = { vim.env.PLACITUM_NODE, vim.env.PLACITUM_SERVER, "--stdio" },
  root_dir = vim.fn.fnamemodify(vim.env.PLACITUM_FILE, ":h"),
})
if id == nil then
  print("NO_START")
  vim.cmd("qa!")
end
local attached = vim.wait(5000, function()
  return #vim.lsp.get_clients({ bufnr = 0 }) > 0
end)
if not attached then
  print("NO_ATTACH")
  vim.cmd("qa!")
end
-- Let the initialize handshake finish before the first request.
vim.wait(500, function() return false end)
local client = vim.lsp.get_clients({ bufnr = 0 })[1]
local result = nil
client:request("textDocument/rename", {
  textDocument = { uri = vim.uri_from_bufnr(0) },
  position = { line = 2, character = 9 },
  newName = "z",
}, function(_, response) result = response end, 0)
vim.wait(5000, function() return result ~= nil end)
if result == nil then
  print("RENAME_FAILED")
  vim.cmd("qa!")
end
vim.lsp.util.apply_workspace_edit(result, client.offset_encoding or "utf-16")
print("RENAMED")
print(table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n"))
vim.cmd("qa!")
`;

describe.skipIf(!hasNvim || !existsSync(BIN))('neovim end-to-end', () => {
  it('renames a shadowed param without corrupting the outer binding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'placitum-lsp-nvim-'));
    const file = join(dir, 'shadow.placitum');
    writeFileSync(file, 'let x = 1\nfn f(x) {\n  return x\n}\nlet y = x\n');
    const luaPath = join(dir, 'rename.lua');
    writeFileSync(luaPath, RENAME_SCRIPT);

    const result = spawnSync('nvim', ['--headless', '-u', 'NONE', '-c', `luafile ${luaPath}`], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        PLACITUM_FILE: file,
        PLACITUM_NODE: process.execPath,
        PLACITUM_SERVER: fileURLToPath(BIN),
      },
    });
    rmSync(dir, { recursive: true, force: true });

    // Headless Neovim routes `print` to stderr; combine both streams.
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toContain('RENAMED');
    expect(output).toContain('  return z');
    expect(output).not.toContain('  return x');
    expect(output).toContain('let y = x');
  }, 30000);
});
