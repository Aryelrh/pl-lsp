# Manual editor checklist

Run once per release for every client whose recipe is not automated, then fill
the date + version columns. Neovim is automated by `tests/e2e/neovim.test.ts`
(driven by the shipped `editors/neovim/init.lua`) and only needs the automated
run recorded.

Checklist per client (see `editors/README.md` for the recipe):

1. `E301` fixture shows a diagnostic with the right range/message.
2. Completion after `needs ` and after `json.` works.
3. Hover (`K`) shows the inferred type.
4. Rename of a shadowed binding leaves the outer binding untouched.
5. The manifest command shows `grants (statically proven):`.
6. No server output on stdout (`--log-level=debug` logs to stderr).

| Client | Recipe | Status | Date | Version | Notes |
|---|---|---|---|---|---|
| Neovim | `editors/neovim/init.lua` | ✅ automated | 2026-09-23 | 0.12.5 | `tests/e2e/neovim.test.ts` (rename, completion+hover, E301+manifest) |
| Neovim 0.10 | `editors/neovim/nvim-lspconfig.lua` | ⏳ pending | — | — | needs nvim-lspconfig; syntax-checked only |
| Helix | `editors/helix/languages.toml` | ⏳ pending | — | — | client not installed on the dev machine; `hx --health placitum` |
| Emacs (eglot) | `editors/emacs/eglot.el` | ⏳ pending | — | — | client not installed on the dev machine |
| Emacs (lsp-mode) | `editors/emacs/lsp-mode.el` | ⏳ pending | — | — | client not installed on the dev machine |
| Zed | `editors/zed/settings.json` | ⏳ pending | — | — | client not installed on the dev machine |
| Sublime Text | `editors/sublime/LSP-placitum.sublime-settings` | ⏳ pending | — | — | needs LSP package + a syntax |
| Vim (vim-lsp) | `editors/vim/vim-lsp.vim` | ⏳ pending | — | — | Vim is installed; vim-lsp plugin is not |
| Vim (coc.nvim) | `editors/vim/coc-settings.json` | ⏳ pending | — | — | needs coc.nvim |
| Kate | `editors/kate/lspclient.json` | ⏳ pending | — | — | client not installed on the dev machine |
| VS Code | teammate repo | n/a | — | — | see `docs/VSCODE-HANDOFF.md` |

Nothing in this table blocks the automated gate (`npm run ci`); the pending rows
are recorded honestly instead of being reported as verified.
