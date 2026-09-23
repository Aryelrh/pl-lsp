-- Placitum LSP for Neovim >= 0.11 (native vim.lsp.config).
-- Copy to ~/.config/nvim/after/ftplugin/placitum.lua or source from init.lua.
-- Requires `placitum-lsp` on PATH (npm link / npm install -g).

vim.filetype.add({ extension = { placitum = "placitum" } })

vim.lsp.config("placitum", {
  cmd = { "placitum-lsp", "--stdio" },
  filetypes = { "placitum" },
  root_markers = { ".git" },
})

vim.lsp.enable("placitum")

-- Optional: show the capability manifest in a floating window.
vim.api.nvim_create_user_command("PlacitumManifest", function()
  local bufnr = vim.api.nvim_get_current_buf()
  local uri = vim.uri_from_bufnr(bufnr)
  vim.lsp.buf_request(bufnr, "placitum/manifest", { textDocument = { uri = uri } },
    function(_, result)
      if not result then return end
      local lines = vim.split(result.markdown, "\n")
      local win = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), true, {
        relative = "editor", width = math.min(80, vim.o.columns - 4),
        height = math.min(#lines, vim.o.lines - 4), row = 2, col = 2,
        style = "minimal", border = "rounded", title = " Placitum manifest ",
      })
      vim.api.nvim_buf_set_lines(vim.api.nvim_win_get_buf(win), 0, -1, false, lines)
      vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = vim.api.nvim_win_get_buf(win) })
    end)
end, {})
