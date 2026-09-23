# VS Code extension handoff

Status: **complete spec** (Phase 7). The extension itself lives in the
teammate's repository; this document is the contract between that extension and
this server. The server is extension-ready: stdio transport, the capability
contract of `initialize` (directive §7.1), no client-specific code, no global
`placitum-lsp` install required when the server is bundled.

Authoritative source for the server side: `placitum-lsp-implementation.md` §9.
Server behavior and degradation per client capability: `docs/COMPATIBILITY.md`.

## 1. What the extension gets

- A Language Server over stdio (`dist/bin.js --stdio`), Node `>= 20`, ESM.
- Full capabilities: diagnostics, completion, hover, signature help,
  definition/type definition, references, rename, document/workspace symbols,
  highlights, folding, selection ranges, semantic tokens, code actions, code
  lens, inlay hints, the custom `placitum/manifest` request and the commands
  `placitum.showManifest`, `placitum.reanalyze`, `placitum.addNeeds`.
- Settings under the `placitum.*` namespace via `workspace/configuration`
  (section `placitum`) or `initializationOptions.placitum`.
- Guarantees: UTF-16 positions, stdout carries only JSON-RPC frames, logs go to
  stderr, user files are never written (edits are returned as `WorkspaceEdit`),
  no process/network calls from feature code.

## 2. Extension skeleton

`package.json` (excerpt; keep the extension id/version yours):

```jsonc
{
  "name": "placitum-vscode",
  "engines": { "vscode": "^1.90.0" },
  "activationEvents": ["onLanguage:placitum"],
  "main": "./out/extension.js",
  "contributes": {
    "languages": [{
      "id": "placitum",
      "aliases": ["Placitum", "placitum"],
      "extensions": [".placitum"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{
      "language": "placitum",
      "scopeName": "source.placitum",
      "path": "./syntaxes/placitum.tmLanguage.json"
    }],
    "commands": [
      { "command": "placitum.showManifest", "title": "Placitum: Show capability manifest" },
      { "command": "placitum.reanalyze", "title": "Placitum: Reanalyze file" }
    ],
    "configuration": {
      "title": "Placitum",
      "properties": {
        "placitum.diagnostics.enable": { "type": "boolean", "default": true },
        "placitum.diagnostics.scope": { "type": "boolean", "default": true },
        "placitum.diagnostics.strictChecks": { "type": "boolean", "default": true },
        "placitum.completion.enable": { "type": "boolean", "default": true },
        "placitum.completion.snippets": { "type": "boolean", "default": true },
        "placitum.codeLens.enable": { "type": "boolean", "default": true },
        "placitum.inlayHints.enable": { "type": "boolean", "default": false },
        "placitum.inlayHints.capabilities": { "type": "boolean", "default": false },
        "placitum.workspaceSymbols.enable": { "type": "boolean", "default": true },
        "placitum.workspaceSymbols.maxFiles": { "type": "number", "default": 2000 }
      }
    }
  },
  "dependencies": { "vscode-languageclient": "^9.0.1" }
}
```

## 3. Client startup

`src/extension.ts`. The server entry point is `dist/bin.js`; run it with the
extension host's Node so no global install is needed:

```ts
import * as path from 'node:path';
import { commands, window, workspace, ExtensionContext, Uri } from 'vscode';
import {
  LanguageClient, LanguageClientOptions, ServerOptions, TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('server', 'dist', 'bin.js'));
  const serverOptions: ServerOptions = {
    command: process.execPath,
    args: [serverModule, '--stdio'],
    transport: TransportKind.stdio,
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: 'placitum' }],
    synchronize: { configurationSection: 'placitum' },
  };
  client = new LanguageClient('placitum-lsp', 'Placitum', serverOptions, clientOptions);
  context.subscriptions.push(client.start());

  context.subscriptions.push(
    commands.registerCommand('placitum.showManifest', async () => {
      const editor = window.activeTextEditor;
      if (editor === undefined || client === undefined) return;
      const result = await client.sendRequest<{ markdown: string }>('placitum/manifest', {
        textDocument: { uri: editor.document.uri.toString() },
      });
      const document = await workspace.openTextDocument({ language: 'markdown', content: result.markdown });
      await window.showTextDocument(document, { preview: true, viewColumn: 2 });
    }),
    commands.registerCommand('placitum.reanalyze', async () => {
      const editor = window.activeTextEditor;
      if (editor === undefined || client === undefined) return;
      await client.sendRequest('workspace/executeCommand', {
        command: 'placitum.reanalyze',
        arguments: [editor.document.uri.toString()],
      });
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
```

Notes:

- `TransportKind.stdio` with `command`/`args` is the supported path because
  `dist/bin.js` owns the CLI and the process lifecycle. If you prefer the
  `run`/`debug` module form, bundle an entry that imports `createServer` from
  `placitum-lsp` and calls `listen()`; do not point it at `dist/server.js`
  directly, that module only exports the factory.
- `documentSelector` must match the language id `placitum`; the extension owns
  the `.placitum` mapping.
- No `clientInfo` branching exists on the server: the same behavior applies to
  every client.

## 4. Bundling the server

Bundle the published `placitum-lsp` **and** its `placitum` dependency into
`server/dist/` (keep it out of this repo). With esbuild, ESM output and the
extension host's Node:

```sh
npx esbuild node_modules/placitum-lsp/dist/bin.js \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile=server/dist/bin.js
```

- Keep the shebang: prepend `#!/usr/bin/env node` if esbuild drops it.
- The core (`placitum`) is pure for our usage (lexer/parser/extractor/explain);
  bundling it is fine. Do not add the evaluator, guard, or host bindings to the
  extension.
- Ship `server/` via `.vscodeignore` rules; the packaged `.vsix` must not need a
  global `placitum-lsp` install.
- **License notice**: `placitum-lsp` and `placitum` are MIT. Keep their `LICENSE`
  text (and `AUTHORS`) inside the bundle, e.g. `server/LICENSE` or a `LICENSES/`
  folder listed in the extension's `LICENSE`/`THIRD-PARTY-NOTICES`; MIT requires
  the copyright notice and permission text to travel with redistributions.

## 5. TextMate grammar (seed)

`syntaxes/placitum.tmLanguage.json` — expand as needed; semantic tokens improve
on this but do not replace it (bracket matching, embedded coloring, and
highlighting when the server is stopped).

```jsonc
{
  "scopeName": "source.placitum",
  "patterns": [
    { "include": "#comments" },
    { "include": "#pragma" },
    { "include": "#strings" },
    { "include": "#numbers" },
    { "include": "#keywords" },
    { "include": "#capabilities" },
    { "include": "#bang-targets" },
    { "include": "#operators" }
  ],
  "repository": {
    "comments": { "match": "#.*$", "name": "comment.line.number-sign.placitum" },
    "pragma": { "match": "^#!\\s*(strict)\\b", "captures": { "1": { "name": "keyword.control.pragma.placitum" } } },
    "strings": {
      "patterns": [
        { "begin": "f\"", "end": "\"", "name": "string.interpolated.placitum" },
        { "begin": "\"", "end": "\"", "name": "string.quoted.double.placitum" }
      ]
    },
    "numbers": { "match": "\\b\\d+(\\.\\d+)?\\b", "name": "constant.numeric.placitum" },
    "keywords": {
      "match": "\\b(needs|let|fn|if|else|while|for|in|return|not|only|true|false|null)\\b",
      "name": "keyword.control.placitum"
    },
    "capabilities": {
      "match": "\\b(fs\\.read|fs\\.write|net|exec|env|only)\\b",
      "name": "support.function.capability.placitum"
    },
    "bang-targets": {
      "match": "\\b([A-Za-z_][A-Za-z0-9_]*)(\\.[A-Za-z_][A-Za-z0-9_]*)*!",
      "captures": { "0": { "name": "entity.name.function.bang.placitum" } }
    },
    "operators": { "match": "==|!=|<=|>=|&&|\\|\\||[+\\-*/=<>|!?]", "name": "keyword.operator.placitum" }
  }
}
```

## 6. Language configuration

`language-configuration.json`:

```json
{
  "comments": { "lineComment": "#" },
  "brackets": [["{", "}"], ["[", "]"], ["(", ")"]],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "[", "close": "]" },
    { "open": "(", "close": ")" },
    { "open": "\"", "close": "\"", "notIn": ["string"] }
  ],
  "surroundingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""]]
}
```

## 7. Commands and manifest

- `placitum.showManifest` (the snippet above) calls the custom request and shows
  `result.markdown` verbatim; it is the same text as `placitum explain`.
- `placitum.reanalyze` forces re-analysis and diagnostics republish.
- `placitum.addNeeds` applies the first uncovered-bang fix through
  `workspace/applyEdit`; VS Code handles the edit, the server never writes.
- Code lens and quick fixes already use `placitum.showManifest`; no extra client
  wiring is required for them.

## 8. Acceptance checklist

- [ ] `vsce package` produces a `.vsix`; installing it in a clean VS Code shows
      diagnostics, completion, hover, rename and the manifest command.
- [ ] No server logs on stdout; `Placitum: Show capability manifest` renders the
      markdown (webview, preview tab, or output channel).
- [ ] Works with no global `placitum-lsp` install (bundled `server/`).
- [ ] The bundled server keeps the MIT `LICENSE`/`AUTHORS` notices.
- [ ] Settings changes under `placitum.*` trigger re-analysis.
- [ ] `synchronize.configurationSection: 'placitum'` is set; no custom
      configuration plumbing is needed.

## 9. Do not

- Branch on `clientInfo.name === 'Visual Studio Code'` (the server never does).
- Reimplement lexing/parsing/capability logic in the extension: every answer
  comes from the server.
- Write user files from the extension for LSP features; apply server
  `WorkspaceEdit`s instead.
- Depend on a globally installed `placitum-lsp`.
