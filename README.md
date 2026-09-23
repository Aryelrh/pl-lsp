# placitum-lsp

Language Server Protocol (LSP) server for **Placitum**, a capability-secure shell
language where every effectful operation is syntactically visible (`name!(...)`),
statically enumerable, and runtime-enforced.

The server is a pure static analyzer: it **never executes** Placitum code. It reuses
the core language implementation (`placitum`, lexer/parser/extractor/explain) verbatim
and exposes it over JSON-RPC on stdio, so any spec-compliant editor works.

- Core language repository: <https://github.com/quesadx/pl-lg>
- Implementation directive (plan of record): [`placitum-lsp-implementation.md`](./placitum-lsp-implementation.md)

## Status

Phases 0–4 complete. The repository scaffold is in place (strict TypeScript, ESLint
import boundaries, dependency allow-list, pinned core `placitum`), and the server runs
over stdio: lifecycle, incremental document sync, per-version analysis cache, debounced
push diagnostics, `workspace/configuration` + `initializationOptions` settings, and
stderr-only logging. Diagnostics cover the core pipeline (`E1xx`–`E3xx`, tolerant
multi-error lexing) plus the LSP analysis engine: binder `E500`/`E506`, `#!strict` `E505`,
and definitely-certain literal checks `E501`–`E504`, each with exact UTF-16 ranges and
config gates. Navigation is live: definition / type definition (`LocationLink` or
`Location` per client), references, scope-aware rename, document symbols (hierarchical or
flat), and capped on-demand workspace symbols with an mtime cache and watched-file
invalidation. Intelligence is live too: context-aware completion, hover (bindings,
builtins, members, bang coverage, capability tokens, keywords), signature help (with pipe
prepend), full semantic tokens, folding, selection ranges and document highlights — all
with fallbacks that keep working on half-typed files.
`npm run ci` is green (typecheck, lint, build, 210 unit/protocol/e2e tests, including a
stdout-purity check and Neovim E2E for rename, completion and hover). Capability UX lands
in phase 5 following the directive.

## Features

| Feature | Details |
|---|---|
| Diagnostics | Core error codes (`E1xx`–`E5xx`) with exact ranges; syntax errors never crash the server |
| Completion | Context-aware: capabilities after `needs`, `fs.read`/`fs.write`, pipe stages, member access, snippets |
| Hover | Bindings, bang calls, capability tokens, deferred (runtime) capability checks |
| Navigation | Definition, type definition, references, rename (`prepareRename`), document/workspace symbols |
| Intelligence | Signature help, semantic tokens, folding, selection ranges, document highlights |
| Capability UX | Quick fixes (add `needs`, insert `}`, rename), code lens, inlay hints, `placitum/manifest` |
| Configuration | `workspace/configuration` + `initializationOptions.placitum`, defensive parsing |

Capabilities advertised at `initialize`: `positionEncoding: utf-16`, incremental sync,
completion (`" "`, `"."`, `"|"` triggers), hover, signature help, definition,
type definition, references, rename, symbols, highlights, folding, selection ranges,
quick fixes, code lens, inlay hints, semantic tokens (full), and the commands
`placitum.showManifest`, `placitum.reanalyze`, `placitum.addNeeds`.

## Requirements

- Node.js `>= 20` (Node 22 recommended; the dev shell pins `nodejs_22`).
- npm (the core `placitum` package is installed from a pinned GitHub commit).
- Optional: Nix with flakes + direnv for a reproducible dev shell.

## Install

### Development (this repository)

```sh
# Option A: Nix dev shell (Node 22)
nix develop          # or: direnv allow

# Install dependencies (core `placitum` from the pinned SHA)
npm install

# Build once the server sources land
npm run build

# Put `placitum-lsp` on PATH for local editors
npm link
```

### Per project

```sh
npm install --save-dev placitum-lsp
npx placitum-lsp --stdio
```

### Global

```sh
npm install -g placitum-lsp
placitum-lsp --stdio
```

> Publishing to npm is not enabled yet; until then use `npm link` / a packed tarball
> (`npm pack`). The server must always be reachable as `placitum-lsp` on `PATH`.

## CLI

```
placitum-lsp [--stdio] [--version] [--help]
             [--log-level=<error|info|debug|trace>] [--log-file=<path>]
```

- `--stdio` — transport (default). Only stdio is supported; `--node-ipc` / `--socket`
  are rejected loudly with exit code 2.
- `--version`, `--help` — print and exit.
- `--log-level`, `--log-file` — logging. **stdout carries only JSON-RPC frames**;
  all logs go to stderr (or the log file).

## Editor setup

Minimal client contract: `initialize` + `didOpen`/`didChange`/`didClose` +
`publishDiagnostics` are enough. Everything else degrades gracefully.

### Neovim (>= 0.11)

```lua
vim.filetype.add({ extension = { placitum = "placitum" } })

vim.lsp.config("placitum", {
  cmd = { "placitum-lsp", "--stdio" },
  filetypes = { "placitum" },
  root_markers = { ".git" },
})

vim.lsp.enable("placitum")

-- Optional: show the capability manifest in a floating window
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
```

A ready-to-copy version (plus an `nvim-lspconfig` 0.10 variant) is shipped in
`editors/neovim/`.

### Helix

`editors/helix/languages.toml`:

```toml
[language-server.placitum]
command = "placitum-lsp"
args = ["--stdio"]

[[language]]
name = "placitum"
scope = "source.placitum"
file-types = ["placitum"]
language-servers = ["placitum"]
comment-token = "#"
indent = { tab-width = 4, unit = "    " }
```

Check detection with `hx --health placitum`. A tree-sitter grammar is required for
syntax highlighting; diagnostics, completion, and hover work without one.

### VS Code

The thin extension is built in a separate (teammate) repository. The server is
extension-ready: stdio transport, no client-specific code, and the full handoff spec
lives in `docs/VSCODE-HANDOFF.md`. The extension bundles the server, so no global
install is needed.

### Emacs (eglot / lsp-mode), Zed, Sublime, Vim, Kate

Copy-paste recipes live in `editors/emacs/`, `editors/zed/`, `editors/sublime/`,
`editors/vim/`, and `editors/kate/`. Zed example:

```json
{
  "lsp": {
    "placitum-lsp": {
      "binary": { "path": "placitum-lsp", "arguments": ["--stdio"] }
    }
  },
  "languages": {
    "Placitum": {
      "language_servers": ["placitum-lsp"],
      "file_types": ["placitum"]
    }
  }
}
```

## Configuration

Served under the `placitum` section via `workspace/configuration`; `initializationOptions.placitum`
overrides defaults at startup. Unknown keys and wrong types fall back to defaults.

```jsonc
{
  "placitum.diagnostics.enable": true,
  "placitum.diagnostics.scope": true,          // E500/E506 binder checks
  "placitum.diagnostics.strictChecks": true,   // E505 + literal-type checks
  "placitum.completion.enable": true,
  "placitum.completion.snippets": true,
  "placitum.codeLens.enable": true,
  "placitum.inlayHints.enable": false,
  "placitum.inlayHints.capabilities": false,
  "placitum.workspaceSymbols.enable": true,
  "placitum.workspaceSymbols.maxFiles": 2000,
  "placitum.trace.server": "off"
}
```

Changing configuration triggers re-analysis and republished diagnostics.

## Development

```sh
npm install
npm run ci        # check-deps -> tsc --noEmit -> eslint -> build -> vitest -> e2e
npm test          # vitest run
```

Layout (target, per directive):

```
src/
  bin.ts              entry point (shebang, CLI flags, startServer)
  server.ts           connection, capabilities, handler wiring
  documents.ts        document map, analysis cache, debounce
  config.ts  log.ts   settings, stderr/file logging
  workspace/files.ts  the only fs reader (workspace symbol scan)
  analysis/           core-adapter, positions, comments, binder, types,
                      checks, capabilities, model
  features/           diagnostics, hover, completion, signature, definition,
                      references, rename, symbols, semantic-tokens, folding,
                      selection, highlights, code-actions, code-lens,
                      inlay-hints, manifest-command
editors/              ready-to-copy client recipes
tests/                unit/ , protocol/ , fixtures/ , e2e/
docs/                 PHASES.md (bitácora por fase), VSCODE-HANDOFF.md,
                      CORE-VERSION.md, BLOCKED.md
```

Rules that make the server safe and portable:

- Never `any`, `@ts-ignore`, or `@ts-expect-error`; TypeScript strict mode.
- Only the core barrel (`placitum`) may be imported, and only through
  `src/analysis/core-adapter.ts`; no evaluator/guard/stdlib/host-bindings.
- No `child_process`, network, or OS modules in feature code; user files are
  untrusted text and are never written directly (edits go through `WorkspaceEdit`).
- Logs never touch stdout; failures are contained, never crash the server.
- Dependencies are restricted to the allow-list in the directive (Section 4.3).

## Troubleshooting

| Symptom | Check |
|---|---|
| Server not starting | `placitum-lsp --version`; ensure `node >= 20` and `placitum-lsp` is on `PATH` |
| No diagnostics | Confirm the buffer filetype is `placitum` and the file is open (push diagnostics need `didOpen`) |
| Want logs | `--log-level=debug` (or `trace`) and optionally `--log-file=<path>`; logs go to stderr only |
| Helix missing features | `hx --health placitum`; highlighting needs a tree-sitter grammar |
| Manifest view | Call `placitum/manifest` (Neovim command above) or run `npx placitum explain <file>` |

## License

See the core repository.
