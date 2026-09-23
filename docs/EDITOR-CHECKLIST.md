# Manual editor checklist

Run once per release for every client whose recipe is not automated. The rows
below record what was actually executed on 2026-09-23 using temporary Nix
installs (`nix shell`/`nix build`, nothing added to the repo). The server was
exposed to each editor through a shim named `placitum-lsp`:

```sh
mkdir -p /tmp/pl-bin
printf '#!/bin/sh\nexec %s %s/dist/bin.js "$@"\n' "$(which node)" "$PWD" > /tmp/pl-bin/placitum-lsp
chmod +x /tmp/pl-bin/placitum-lsp
export PATH=/tmp/pl-bin:$PATH PLACITUM_NODE="$(which node)" PLACITUM_SERVER="$PWD/dist/bin.js"
```

Checklist per client (see `editors/README.md` for the recipe):

1. `E301`/`E500` fixture shows a diagnostic with the right range/message.
2. Completion after `needs ` and after `json.` works.
3. Hover (`K`) shows the inferred type.
4. Rename of a shadowed binding leaves the outer binding untouched.
5. The manifest command shows `grants (statically proven):`.
6. No server output on stdout (`--log-level=debug` logs to stderr).

| Client | Recipe | Status | Date | Version | Evidence |
|---|---|---|---|---|---|
| Neovim | `editors/neovim/init.lua` | ✅ automated | 2026-09-23 | 0.12.5 | `tests/e2e/neovim.test.ts`: rename, completion + hover, E301 + manifest |
| Neovim 0.10 | `editors/neovim/nvim-lspconfig.lua` | ✅ verified | 2026-09-23 | 0.10.2 + lspconfig 2024-11-12 | attached + E500 published |
| Helix | `editors/helix/languages.toml` | ✅ verified | 2026-09-23 | 25.07.1 | E301, hover (`param x: unknown`), completion (`config`), scope-aware rename, `:lsp-workspace-command` → manifest |
| Emacs (eglot) | `editors/emacs/eglot.el` | ✅ verified | 2026-09-23 | 31.1 (bundled eglot) | E500 received, plaintext hover, completion (`config`), rename (2 scope-correct edits) |
| Emacs (lsp-mode) | `editors/emacs/lsp-mode.el` | ✅ verified | 2026-09-23 | 31.1 + lsp-mode 20260905 | connected, 19 capabilities, markdown hover |
| Vim (vim-lsp) | `editors/vim/vim-lsp.vim` | ✅ verified | 2026-09-23 | vim-lsp 0.1.4 | server `running` via the recipe, E500 received |
| Vim (coc.nvim) | `editors/vim/coc-settings.json` | ⏳ pending | — | — | config JSON validated; coc needs an interactive host |
| Zed | `editors/zed/settings.json` | ⏳ pending | — | 1.20.1 available | GUI app, no headless LSP probe |
| Sublime Text | `editors/sublime/LSP-placitum.sublime-settings` | ⏳ pending | — | — | not packaged in nixpkgs |
| Kate | `editors/kate/lspclient.json` | ⏳ pending | — | — | not packaged in nixpkgs; GUI app |
| VS Code | teammate repo | n/a | — | — | see `docs/VSCODE-HANDOFF.md` |

## Reproduce the Nix runs

The exact commands and the check scripts live in
[`editors/checks/`](../editors/checks/README.md). Summary:

```sh
# Helix (tmux drives the keys; assertions read the LSP log and a written buffer)
PLACITUM_FILE=<e301> PLACITUM_CLEAN=<clean> nix shell nixpkgs#helix nixpkgs#tmux -c editors/checks/helix.sh

# Neovim 0.10 + lspconfig (recipe targets the old API)
PLACITUM_FILE=<fixture> nix shell github:NixOS/nixpkgs/nixos-24.11#neovim -c nvim ... editors/checks/nvim-lspconfig.lua

# Emacs eglot / lsp-mode
PLACITUM_FILE=<fixture> nix shell nixpkgs#emacs-nox -c emacs -Q --batch -l editors/checks/emacs-eglot.el
PLACITUM_FILE=<fixture> <emacs-with-lsp-mode> -Q --batch -l editors/checks/emacs-lsp-mode.el

# Vim + vim-lsp
PLACITUM_FILE=<fixture> vim -es -u NONE --cmd "set loadplugins" --cmd "set runtimepath^=$VIMLSP" -c "source editors/checks/vim-lsp.vim"
```

Nothing in the pending rows blocks the automated gate (`npm run ci`); they are
recorded honestly instead of being reported as verified.
