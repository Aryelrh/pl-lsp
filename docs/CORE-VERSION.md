# Core `placitum` version pin

- Package: `placitum` (quesadx/pl-lg), pinned in `package.json` as
  `github:quesadx/pl-lg#dd1f362b35888d8a19b2215772db2389e8bb244a`.
- Adapter: `src/analysis/core-adapter.ts`; its `CORE_API_VERSION` must equal this SHA.
- The server imports only the root barrel, and only through the adapter. It never
  imports the evaluator, guard, stdlib runtime, or host bindings.

## Required API surface (directive §5) — present in this pin

| Directive item | Status in this pin |
|---|---|
| §5.1 public barrel + package `exports` map (`dist/index.js`, `dist/index.d.ts`) | present |
| §5.2 `analyzeSource`, tolerant lexing/parsing, `CommentTrivia` export | present |
| §5.3 `collectStrictDiagnostics`, `inferType`, `calleeSignature` | present (`dist/analysis/strict.js`) |
| §5.1 tables for features | `explain`, `compileManifest`, `BANG_REGISTRY`, `BANG_SIGNATURES`, `PURE_SIGNATURES`, `AMBIENT_BANGS`, `EFFECTFUL_STDLIB`, `globToRegex`, `globCovers`, `hostToRegex`, error classes |

## `analyzeSource` behavior this server relies on

- `tokens`/`comments` are always best-effort: lexing recovers and reports every lex
  error it finds in one pass.
- Parsing runs only when there are **zero** lex diagnostics; in that case a recovered
  `program` may still be non-null alongside parse diagnostics.
- `extract()` runs only when lex + parse produced zero diagnostics, so a recovered AST
  never yields cascading capability (`E3xx`) errors.
- `complete` is `diagnostics.length === 0`; `manifest` is non-null only for clean parses.

## How to bump

1. `npm i "placitum@git+https://github.com/quesadx/pl-lg.git#<sha>"`.
2. Update `CORE_API_VERSION` in `src/analysis/core-adapter.ts`.
3. Update this file and run `npm run ci`; the adapter smoke test proves the contract.
