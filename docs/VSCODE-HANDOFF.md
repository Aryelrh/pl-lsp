# VS Code extension handoff

Status: **skeleton** (Phase 0). This document is completed and reviewed in Phase 7;
its authoritative source is directive §9 (`placitum-lsp-implementation.md`).

The server is extension-ready when:

- stdio transport works (`placitum-lsp --stdio`);
- `initialize` advertises the capability contract of directive §7.1;
- no client-specific server code exists (the server never branches on client name).

## Teammate checklist (to be filled in Phase 7)

- [ ] Extension skeleton (`package.json` contributions: language id `placitum`,
      `.placitum` extension, TextMate grammar, language configuration).
- [ ] `LanguageClient` startup over stdio, `documentSelector: [{ language: 'placitum' }]`,
      `synchronize.configurationSection: 'placitum'`.
- [ ] Bundle the published server + core `placitum` package (esbuild recommended).
- [ ] Seed TextMate grammar from the core token cheat sheet.
- [ ] Language configuration: line comment `#`, brackets, auto-closing pairs.
- [ ] Commands: map `placitum.showManifest` to the `placitum/manifest` request.
- [ ] Settings mirroring the `placitum.*` namespace.
- [ ] `vsce package` smoke: diagnostics, completion, hover, rename, manifest command,
      no stdout logs, no global `placitum-lsp` install required.
