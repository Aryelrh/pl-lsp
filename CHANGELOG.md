# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-root workspace symbols: `workspace/didChangeWorkspaceFolders` rescans
  added/removed folders and container names are prefixed with the folder when
  there is more than one root.
- Pull diagnostics (`textDocument/diagnostic`, LSP 3.17) for clients that
  declare support, with version+config `resultId`s; push stays for everyone else.
- Semantic token deltas (`semanticTokens/full/delta`) with per-version
  `resultId`s and a minimal single-edit diff.

## [0.1.0] - 2026-09-23

First complete development cycle (phases 0–6 of the implementation directive).
Not published to npm; the package is `private` and installed via `npm link` or a
packed tarball.

### Added

- **Server core**: stdio JSON-RPC server reusing the pinned `placitum` core
  (lex/parse/extract/explain only — code is never executed), strict TypeScript,
  import boundaries, dependency allow-list, stderr-only logging, UTF-16
  positions.
- **Diagnostics**: core `E1xx`–`E3xx` with exact ranges, binder `E500`/`E506`,
  `#!strict` `E505`, definitely-certain literal checks `E501`–`E504`, each with
  config gates and debounced push publishing.
- **Navigation**: definition / type definition (`LocationLink` or `Location`),
  references, scope-aware rename with collision checks, hierarchical or flat
  document symbols, capped on-demand workspace symbols with mtime cache and
  watched-file invalidation.
- **Intelligence**: context-aware completion, hover (bindings, builtins,
  members, bang coverage, capability tokens, keywords), signature help with pipe
  prepend, full semantic tokens (golden-tested), folding, selection ranges and
  document highlights, all with recovered-parse fallbacks.
- **Capability UX**: deterministic quick fixes (`add needs`, insert `}`,
  declare with `let`, rename redeclarations), code lens over `needs` clauses,
  optional inlay hints, the custom `placitum/manifest` request (core `explain`
  output byte for byte), and the commands `placitum.showManifest`,
  `placitum.reanalyze` and `placitum.addNeeds`.
- **Compatibility**: capability-by-capability degradation for minimal clients,
  recipes for Neovim (0.11+ and 0.10 + nvim-lspconfig), Helix, Emacs (eglot and
  lsp-mode), Zed, Sublime, Vim (vim-lsp and coc.nvim) and Kate, plus the
  compatibility matrix and per-editor checklist.
- **Tests**: unit, in-process protocol, golden fixtures and end-to-end (raw
  stdio framing, stdout purity, Neovim driving the shipped recipe).

[Unreleased]: https://github.com/Aryelrh/pl-lsp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Aryelrh/pl-lsp/releases/tag/v0.1.0
