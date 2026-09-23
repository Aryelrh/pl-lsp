-- Batch check for editors/neovim/nvim-lspconfig.lua (Neovim 0.10 + old API).
-- Run with:
--   nvim --headless -u NONE --cmd "set runtimepath^=$LSPCONFIG" --cmd "set loadplugins" \
--     -c "filetype on" -c "luafile editors/neovim/nvim-lspconfig.lua" \
--     -c "luafile editors/checks/nvim-lspconfig.lua"
-- Expects PLACITUM_FILE to point at a fixture with an E500.
vim.cmd("edit " .. vim.env.PLACITUM_FILE)
local attached = vim.wait(6000, function()
  return #vim.lsp.get_clients({ bufnr = 0 }) > 0
end)
print((attached and "PASS" or "FAIL") .. " attached")
vim.wait(3000, function()
  return #vim.diagnostic.get(0) > 0
end)
print((#vim.diagnostic.get(0) > 0 and "PASS" or "FAIL") .. " diagnostics")
vim.cmd("qa!")
