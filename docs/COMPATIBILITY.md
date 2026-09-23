# Compatibility matrix

Every LSP feature is optional: the server advertises all of them in `initialize`
and degrades when the client does not. The machine-checked matrix lives in
`tests/protocol/compatibility.test.ts` (in-process, no editor required); the
per-editor expectations are below.

Position encoding is always **UTF-16** (same units as the core spans); the
server never negotiates `utf-8`/`utf-32`.

## Minimal client contract

`initialize` + `didOpen`/`didChange`/`didClose` + `publishDiagnostics` are
enough to be useful. Everything else degrades gracefully:

| Feature | Client capability that enables it | Behavior without it | Verified by |
|---|---|---|---|
| Diagnostics (push) | `textDocument.publishDiagnostics` | Still analyzed; the server just publishes | `diagnostics.test.ts` |
| Incremental sync | `textDocument.sync` | The server declares `change: 2`; full-text `didChange` also works | `lifecycle.test.ts` |
| Settings | `workspace.configuration` | `initializationOptions.placitum` or defaults; no config request is sent | `compatibility.test.ts` |
| Watched-file invalidation | `workspace.didChangeWatchedFiles.dynamicRegistration` | No registration; workspace-symbol cache invalidates on the next scan (mtime) | `compatibility.test.ts` |
| Definition | `textDocument.definition.linkSupport` | `Location[]` instead of `LocationLink[]` | `navigation.test.ts` |
| Hover | `textDocument.hover.contentFormat` | Plain-text string instead of `MarkupContent` | `intelligence.test.ts` |
| Completion | `textDocument.completion.completionItem.snippetSupport` / `documentationFormat` | Plain `label`/`textEdit`, plain-text docs; snippets are never inserted as literal `${1}` | `compatibility.test.ts` |
| Document symbols | `textDocument.documentSymbol.hierarchicalDocumentSymbolSupport` | Flat `SymbolInformation[]` with `containerName` | `compatibility.test.ts` |
| Workspace symbols | none (provider is static) | No root/folders → `[]`; no index is ever built | `compatibility.test.ts` |
| Semantic tokens | `textDocument.semanticTokens` | Client keeps its own highlighting | `semantic-tokens` golden |
| Folding / selection / highlights | respective client capabilities | Features simply not requested | `intelligence.test.ts` |
| Quick fixes | `textDocument.codeAction.codeActionLiteralSupport` (universal since LSP 3.8) | A pre-3.8 client would receive `CodeAction` objects it cannot apply; use a client from this decade | `capabilities.test.ts` |
| Code lens / inlay hints | `textDocument.codeLens` / `textDocument.inlayHints` | Features not requested; config defaults keep inlay hints off | `capabilities.test.ts` |
| `placitum/manifest` | none (custom request) | Recipe/command hooks only | `capabilities.test.ts` |
| Commands | none (custom methods) | The three advertised ids; without arguments the server falls back to the only open document (Helix-style palettes) | `capabilities.test.ts` |
| Unknown requests | — | JSON-RPC `MethodNotFound` (-32601), server stays alive | `lifecycle.test.ts` |

## Editor matrix

Legend: ✅ exercised on this machine · ⚠️ expected (standard request; not
individually exercised) or limited · ❓ not verified (client not available
headlessly) · n/a not applicable. Dates, versions and commands are recorded in
`docs/EDITOR-CHECKLIST.md`.

| Editor | Diagnostics | Completion/Hover | Rename | Symbols | Semantic tokens | Code actions / lens / hints | Manifest |
|---|---|---|---|---|---|---|---|
| Neovim 0.12 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Neovim 0.10 + lspconfig | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Helix 25.07 | ✅ | ✅ | ✅ | ⚠️ | ⚠️ needs tree-sitter grammar | ⚠️ | ✅ `:lsp-workspace-command` |
| Emacs 31 (eglot) | ✅ | ✅ (plaintext fallback) | ✅ | ⚠️ | ⚠️ client-dependent | ⚠️ | ⚠️ custom request |
| Emacs 31 (lsp-mode) | ⚠️ | ✅ (markdown) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Vim (vim-lsp) | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Vim (coc.nvim) | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| Zed | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| Sublime Text (LSP) | ❓ needs a syntax for the selector | ❓ | ❓ | ❓ | ❌ LSP package does not request them | ❓ | ❓ |
| Kate | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| VS Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (teammate extension) |

Neovim is covered by the automated E2E (`tests/e2e/neovim.test.ts`), which
drives the shipped `editors/neovim/init.lua` recipe. Helix, both Emacs clients,
Vim/vim-lsp and Neovim 0.10 were exercised with temporary Nix installs; the
exact commands live in `docs/EDITOR-CHECKLIST.md`. Zed, Kate, Sublime and
coc.nvim have no headless test surface here and remain unverified.

## Honest limitations

- **Helix and Zed** need a tree-sitter grammar for syntax highlighting; Helix
  only requests semantic tokens when the language has a grammar. Diagnostics,
  completion, hover, symbols, rename, code actions and code lens do not depend
  on the grammar.
- **Sublime** needs a syntax definition for the `source.placitum` selector (or a
  plain-text selector); the LSP package does not consume semantic tokens.
- **UTF-16 only**: positions in every response use UTF-16 code units, matching
  the core spans. Emoji count as 2.
- **Pull diagnostics** are not implemented; the server pushes. Clients that only
  support pull (none of the above) would see no diagnostics.
- **Single root**: workspace symbols scan the provided roots; multi-root folders
  are all scanned, but the response is not filtered per folder.
