# Editor recipes

Copy-paste configuration for each client. The server must be reachable as
`placitum-lsp` on `PATH` (`npm link`, `npm install -g placitum-lsp`, or a packed
tarball). Node `>= 20`.

| Client | Recipe | Tested version | Automated? |
|---|---|---|---|
| Neovim ≥ 0.11 | [`neovim/init.lua`](./neovim/init.lua) | 0.12.5 | yes (`tests/e2e/neovim.test.ts`) |
| Neovim 0.10 + nvim-lspconfig | [`neovim/nvim-lspconfig.lua`](./neovim/nvim-lspconfig.lua) | not run (syntax-checked) | no |
| Helix | [`helix/languages.toml`](./helix/languages.toml) | not run | no |
| Emacs (eglot) | [`emacs/eglot.el`](./emacs/eglot.el) | not run | no |
| Emacs (lsp-mode) | [`emacs/lsp-mode.el`](./emacs/lsp-mode.el) | not run | no |
| Zed | [`zed/settings.json`](./zed/settings.json) | not run | no |
| Sublime Text (LSP) | [`sublime/LSP-placitum.sublime-settings`](./sublime/LSP-placitum.sublime-settings) | not run | no |
| Vim (vim-lsp) | [`vim/vim-lsp.vim`](./vim/vim-lsp.vim) | not run | no |
| Vim (coc.nvim) | [`vim/coc-settings.json`](./vim/coc-settings.json) | not run | no |
| Kate | [`kate/lspclient.json`](./kate/lspclient.json) | not run | no |
| VS Code | teammate repo; see [`../docs/VSCODE-HANDOFF.md`](../docs/VSCODE-HANDOFF.md) | n/a | n/a |

## Manual checklist (per client)

Run once per release and record the date + client version in
[`../docs/EDITOR-CHECKLIST.md`](../docs/EDITOR-CHECKLIST.md):

1. Open a `.placitum` file with a known `E301`; a diagnostic appears with the
   right range and message.
2. Completion after `needs ` offers capability starters; `json.` offers `parse`.
3. Hover (`K`) on a binding shows its inferred type.
4. Rename a shadowed binding; the outer binding is untouched.
5. `placitum/manifest` (or the client's command hook) shows
   `grants (statically proven):`.
6. No `placitum-lsp` output leaks to stdout; `--log-level=debug` shows logs on
   stderr.

## Per-client notes

- **Helix**: syntax highlighting requires a tree-sitter grammar, which does not
  exist yet; diagnostics, completion, hover and document symbols work without it.
  Semantic tokens are only requested when the language has a grammar. Confirm
  detection with `hx --health placitum`.
- **Zed**: the language id needs a manual `languages` entry (included) or an
  extension; highlighting needs a grammar. The LSP features themselves are
  standard.
- **Sublime**: the LSP package needs a syntax definition for the
  `source.placitum` selector; diagnostics work with a plain-text view too if you
  set the selector to `text.plain`.
- **Emacs**: define `placitum-mode` (both recipes include a minimal one) or reuse
  any mode that activates the language.
- **Kate**: copy `lspclient.json` into `~/.local/share/kate/lspclient/` (or merge
  it with your existing `settings.json`).
- **VS Code**: the extension is built in a separate repository; the server is
  already extension-ready (see the handoff doc).
