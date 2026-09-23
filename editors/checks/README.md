# Manual editor checks (not part of `npm run ci`)

Small scripts used to verify the recipes against real clients installed
temporarily with Nix. They are documentation-grade: run them by hand before a
release and record the result in `../../docs/EDITOR-CHECKLIST.md`.

Common setup (shim the server as `placitum-lsp` on `PATH`):

```sh
mkdir -p /tmp/pl-bin
printf '#!/bin/sh\nexec %s %s/dist/bin.js "$@"\n' "$(which node)" "$PWD" > /tmp/pl-bin/placitum-lsp
chmod +x /tmp/pl-bin/placitum-lsp
export PATH=/tmp/pl-bin:$PATH PLACITUM_NODE="$(which node)" PLACITUM_SERVER="$PWD/dist/bin.js"
npm run build
```

Then:

```sh
# Emacs (bundled eglot)
PLACITUM_FILE=<fixture> nix shell nixpkgs#emacs-nox -c emacs -Q --batch -l editors/checks/emacs-eglot.el

# Emacs (lsp-mode, wrapped with the package on load-path)
EMACS=$(nix build --impure --no-link --print-out-paths \
  --expr 'with import (builtins.getFlake "nixpkgs") {}; (emacsPackagesFor emacs-nox).withPackages (p: [ p.lsp-mode ])')/bin/emacs
PLACITUM_FILE=<fixture> "$EMACS" -Q --batch -l editors/checks/emacs-lsp-mode.el

# Vim + vim-lsp
VIMLSP=$(nix build nixpkgs#vimPlugins.vim-lsp --print-out-paths --no-link)
PLACITUM_FILE=<fixture> vim -es -u NONE --cmd "set loadplugins" \
  --cmd "set runtimepath^=$VIMLSP" -c "source editors/checks/vim-lsp.vim"

# Neovim 0.10 + nvim-lspconfig (the recipe targets the old API); prints on stderr
LSPCONFIG=$(nix build github:NixOS/nixpkgs/nixos-24.11#vimPlugins.nvim-lspconfig --print-out-paths --no-link)
PLACITUM_FILE=<fixture> nix shell github:NixOS/nixpkgs/nixos-24.11#neovim -c \
  nvim --headless -u NONE --cmd "set runtimepath^=$LSPCONFIG" --cmd "set loadplugins" \
  -c "filetype on" -c "luafile editors/neovim/nvim-lspconfig.lua" \
  -c "luafile editors/checks/nvim-lspconfig.lua" 2>&1

# Helix (tmux drives the keys; assertions read Helix's LSP log)
PLACITUM_FILE=<fixture> PLACITUM_CLEAN=<clean fixture> nix shell nixpkgs#helix nixpkgs#tmux -c editors/checks/helix.sh
```

Each script prints `PASS`/`FAIL` markers (or asserts in the shell) and exits
non-zero on failure.
