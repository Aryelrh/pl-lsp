import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = new URL('../../dist/bin.js', import.meta.url);
const RECIPE = fileURLToPath(new URL('../../editors/neovim/init.lua', import.meta.url));
const hasNvim = spawnSync('nvim', ['--version'], { stdio: 'ignore' }).status === 0;

const CAPABILITY_SCRIPT = `
vim.cmd("edit " .. vim.env.PLACITUM_FILE)
local attached = vim.wait(5000, function()
  return #vim.lsp.get_clients({ bufnr = 0 }) > 0
end)
if not attached then
  print("NO_ATTACH")
  vim.cmd("qa!")
end
vim.wait(5000, function() return #vim.diagnostic.get(0) > 0 end)
local diags = vim.diagnostic.get(0)
print("DIAG_COUNT=" .. #diags)
if diags[1] ~= nil then
  print("DIAG_CODE=" .. tostring(diags[1].code))
end
vim.cmd("edit " .. vim.env.PLACITUM_CLEAN)
vim.wait(500, function() return false end)
local client = vim.lsp.get_clients({ bufnr = 0 })[1]
local manifest = nil
client:request("placitum/manifest", { textDocument = { uri = vim.uri_from_bufnr(0) } },
  function(_, response) manifest = response end, 0)
vim.wait(5000, function() return manifest ~= nil end)
local ok = manifest ~= nil and manifest.markdown ~= nil
  and manifest.markdown:find("grants %(statically proven%)") ~= nil
print("MANIFEST_OK=" .. tostring(ok))
vim.cmd("qa!")
`;

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

const COMPLETION_HOVER_SCRIPT = `
vim.cmd("edit " .. vim.env.PLACITUM_FILE)
vim.lsp.start({
  name = "placitum",
  cmd = { vim.env.PLACITUM_NODE, vim.env.PLACITUM_SERVER, "--stdio" },
  root_dir = vim.fn.fnamemodify(vim.env.PLACITUM_FILE, ":h"),
})
local attached = vim.wait(5000, function()
  return #vim.lsp.get_clients({ bufnr = 0 }) > 0
end)
if not attached then
  print("NO_ATTACH")
  vim.cmd("qa!")
end
vim.wait(500, function() return false end)
local client = vim.lsp.get_clients({ bufnr = 0 })[1]
local uri = vim.uri_from_bufnr(0)
local completion = nil
client:request("textDocument/completion", {
  textDocument = { uri = uri },
  position = { line = 1, character = 5 },
}, function(_, response) completion = response end, 0)
vim.wait(5000, function() return completion ~= nil end)
local labels = {}
for _, item in ipairs(completion or {}) do table.insert(labels, item.label) end
local hover = nil
client:request("textDocument/hover", {
  textDocument = { uri = uri },
  position = { line = 0, character = 5 },
}, function(_, response) hover = response end, 0)
vim.wait(5000, function() return hover ~= nil end)
local has_config = false
for _, label in ipairs(labels) do if label == "config" then has_config = true end end
print("COMPLETION_HAS_CONFIG=" .. tostring(has_config))
local member = nil
client:request("textDocument/completion", {
  textDocument = { uri = uri },
  position = { line = 2, character = 5 },
}, function(_, response) member = response end, 0)
vim.wait(5000, function() return member ~= nil end)
local has_parse = false
for _, item in ipairs(member or {}) do if item.label == "parse" then has_parse = true end end
print("COMPLETION_HAS_PARSE=" .. tostring(has_parse))
print("HOVER=" .. ((hover and hover.contents and hover.contents.value) or "nil"))
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

  it('serves completion and markdown hover', () => {
    const dir = mkdtempSync(join(tmpdir(), 'placitum-lsp-nvim-'));
    const file = join(dir, 'hover.placitum');
    writeFileSync(file, 'let config = 1\nlet c\njson.');
    const luaPath = join(dir, 'intel.lua');
    writeFileSync(luaPath, COMPLETION_HOVER_SCRIPT);

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

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toContain('COMPLETION_HAS_CONFIG=true');
    expect(output).toContain('COMPLETION_HAS_PARSE=true');
    expect(output).toContain('HOVER=');
    expect(output).toContain('**let** `config`');
  }, 30000);

  it('runs the shipped recipe: E301 diagnostic + manifest command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'placitum-lsp-nvim-'));
    mkdirSync(join(dir, '.git'));
    const file = join(dir, 'uncovered.placitum');
    writeFileSync(file, 'let config = fs.readFile!("/etc/app.json")\n');
    const clean = join(dir, 'clean.placitum');
    writeFileSync(clean, 'needs net("api.example.com")\nlet r = curl!("https://api.example.com/v1")\n');
    const luaPath = join(dir, 'capability.lua');
    writeFileSync(luaPath, CAPABILITY_SCRIPT);

    // The recipe calls `placitum-lsp` from PATH; shim it to the built server.
    const shim = join(dir, 'placitum-lsp');
    writeFileSync(shim, `#!/bin/sh\nexec "$PLACITUM_NODE" "$PLACITUM_SERVER" "$@"\n`);
    chmodSync(shim, 0o755);

    const result = spawnSync('nvim', ['--headless', '-u', RECIPE, '-c', `luafile ${luaPath}`], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
        PLACITUM_FILE: file,
        PLACITUM_CLEAN: clean,
        PLACITUM_NODE: process.execPath,
        PLACITUM_SERVER: fileURLToPath(BIN),
      },
    });
    rmSync(dir, { recursive: true, force: true });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toContain('DIAG_COUNT=1');
    expect(output).toContain('DIAG_CODE=E301_EXTRACT_UNCOVERED_CAPABILITY');
    expect(output).toContain('MANIFEST_OK=true');
  }, 30000);
});
