-- Placitum LSP for Neovim 0.10 + nvim-lspconfig.
-- Requires `placitum-lsp` on PATH (npm link / npm install -g).

vim.filetype.add({ extension = { placitum = "placitum" } })

local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")
local util = require("lspconfig.util")

if not configs.placitum then
  configs.placitum = {
    default_config = {
      cmd = { "placitum-lsp", "--stdio" },
      filetypes = { "placitum" },
      root_dir = util.root_pattern(".git"),
      single_file_support = true,
    },
  }
end

lspconfig.placitum.setup({})
