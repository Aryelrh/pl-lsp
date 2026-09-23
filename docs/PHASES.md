# Bitácora de fases — placitum-lsp

Este documento explica, fase por fase, **qué se construyó, por qué existe y qué
conceptos hay detrás**. Se actualiza al cerrar cada fase del plan de referencia
(`placitum-lsp-implementation.md`). Está en español porque es material de estudio;
el código, los mensajes y la documentación de producto van en inglés, como exige la
directiva.

- Estado actual: **Fases 0–6 completas; Fase 7 en curso** (solo la revisión del
  teammate y el `vsce package` quedan fuera de este repo); **Fase 8 parcial**
  (multi-root, pull diagnostics, delta de semantic tokens y publicación a npm:
  `placitum@1.0.0` + `placitum-lsp@0.1.0`) · `npm run ci` verde (274 tests + smoke
  de empaquetado)
- Cómo leer: cada fase tiene *Objetivo → Conceptos → Qué se construyó → Decisiones y
  límites → Tests y gate → Cómo probarlo a mano*.

---

## Glosario rápido

| Término | Qué es |
|---|---|
| **LSP** | Language Server Protocol: protocolo estándar entre un editor (cliente) y un servidor de lenguaje. Define métodos (`textDocument/definition`, …) y notificaciones (`textDocument/publishDiagnostics`, …). |
| **JSON-RPC** | Formato de mensajes del LSP: `{jsonrpc, id, method, params}` para requests, `{jsonrpc, id, result/error}` para responses, sin `id` para notifications. |
| **stdio / framing** | El servidor habla por stdin/stdout. Cada mensaje va precedido por `Content-Length: N\r\n\r\n`. Por eso **stdout es sagrado**: un `console.log` lo rompe. |
| **Capability** | (1) En LSP: lo que cliente y servidor declaran saber hacer en `initialize`. (2) En Placitum: permiso de efecto (`fs.read`, `net`, …). El contexto lo aclara. |
| **Diagnostic** | Error/warning con rango, código, mensaje. El LSP los *empuja* (`publishDiagnostics`). |
| **Position encoding** | Cómo se cuentan columnas. Acá siempre UTF-16 (unidades de código), igual que los spans del core. Un emoji cuenta 2. |
| **Span** | Par `[start, end)` de offsets UTF-16 sobre el texto completo, tal como los reporta el core. |
| **Manifest** | Resultado del extractor: qué grants (`needs`) tiene el programa y cada `fn` (`scoped`), más los chequeos diferidos a runtime (`deferredToRuntime`). |
| **Deferred** | Un bang call cuyo argumento no es un literal: no se puede verificar estáticamente, se difiere al guard de runtime. No es error. |
| **Binder** | Pase de análisis que resuelve scopes, declaraciones, usos (occurrences) y tipos por binding, sin ejecutar nada. |
| **Gate** | Criterio de cierre de una fase: tests + CI verde. No se empieza la fase siguiente sin gate. |
| **Ponytail** | Comentario en el código que marca una simplificación deliberada, su techo y el camino de mejora. |

---

## Fase 0 — Scaffold y contrato con el core

**Estado:**  completada (gate compartido con Fase 1: 37 tests).

### Objetivo

Preparar el repositorio y fijar el contrato con `quesadx/pl-lg` (el intérprete de
Placitum) para poder reutilizarlo **sin reimplementar** lexer/parser/extractor.

### Conceptos

- **Pipeline puro vs. ejecución.** El servidor sólo puede usar las fases puras del
  core: `lex → parse → extract → explain` y análisis estático. Nunca el evaluador, el
  guard ni los host bindings. Un archivo malicioso sólo puede producir diagnósticos.
- **Adapter (`core-adapter.ts`).** Única frontera permitida con `placitum`. Aísla la
  versión y el API: si el core cambia, se toca un solo archivo.
- **Pin por SHA.** La dependencia es `github:quesadx/pl-lg#<sha>`; un commit inmutable
  hace reproducibles los builds (el `prepare` del core compila `dist` al instalar).
- **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`: obligan a manejar `undefined` y a declarar imports de tipos.
- **Allow-list de dependencias + lint de frontera.** `scripts/check-deps.mjs` rechaza
  paquetes fuera de la lista; ESLint prohíbe importar `placitum/*` fuera del adapter,
  y `fs`/procesos/red fuera de `workspace/files.ts` y `log.ts`.
- **Posiciones UTF-16.** El core reporta `line`/`col` 1-based y `span` UTF-16. El LSP
  usa la misma codificación (`positionEncoding: utf-16`), así que la conversión es
  directa; `positions.ts` centraliza el clamping (EOF, spans invertidos, CRLF, emojis).

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Scripts `check-deps/typecheck/lint/build/test/ci`, bin `placitum-lsp`, core pinneado. |
| `tsconfig.json` / `tsconfig.build.json` | Strict para todo; build sólo de `src` a `dist`. |
| `.eslintrc.json` | Fronteras de import por archivo. |
| `scripts/check-deps.mjs` | Allow-list + pin por SHA. |
| `src/analysis/core-adapter.ts` | `analyze()`, `strictDiagnostics()`, `signatureOf()`, tablas del core, re-export de tipos. |
| `src/analysis/positions.ts` | Span/line/col ↔ `Range`, con clamping. |
| `src/analysis/model.ts` | Objeto `Analysis` (todo lo derivado de una versión del documento). |
| `tests/fixtures/rosetta.placitum` | Programa de referencia con grants, fn atenuada, pipe, curl, print. |
| `docs/CORE-VERSION.md` | SHA + APIs requeridas y comportamiento de `analyzeSource`. |

### Decisiones y límites

- El core ya traía el contrato de la Fase 0 (barrel público, `analyzeSource` tolerante,
  `collectStrictDiagnostics`, `inferType`), así que no hubo que tocar `pl-lg`.
- `analyzeSource` corre `extract()` **sólo** si no hubo errores de lex/parse: un AST
  recuperado nunca genera errores de capability en cascada.

### Cómo verificarlo

```sh
npm run ci                     # check-deps -> typecheck -> lint -> build -> tests
npx vitest run tests/unit/core-adapter.test.ts
```

---

## Fase 1 — Servidor y diagnósticos

**Estado:**  completada.

### Objetivo

Un servidor LSP real sobre stdio, con ciclo de vida, sincronización de documentos y
diagnósticos del core (errores de sintaxis y capabilities) publicados al editor.

### Conceptos

- **Ciclo de vida LSP.** `initialize` (negociación de capabilities) → `initialized` →
  `shutdown` → `exit`. El servidor declara `positionEncoding`, sync de documentos y
  providers; el cliente declara qué soporta.
- **Sincronización incremental.** `didOpen/didChange/didClose/didSave`. Con `change: 2`
  el cliente manda sólo el fragmento editado; `TextDocuments` mantiene el texto vivo.
- **Análisis por versión + caché.** Cada documento tiene `version`; al cambiar se
  re-analiza y se cachea el `Analysis` de esa versión.
- **Debounce (80 ms).** Mientras se tipea, se espera a que el usuario pause antes de
  publicar diagnósticos: evita parpadeo y trabajo repetido.
- **Push diagnostics.** El servidor *empuja* `textDocument/publishDiagnostics`; no hay
  que pedirlos (pull queda fuera de alcance). Al cerrar el documento se publica `[]`.
- **Mapeo de error a diagnóstico.** `severity` (Error), `code` completo
  (`E301_EXTRACT_...`), `source: "placitum"`, `message` + `hint`, `data` opaco con la
  fase y el hint para futuros quick fixes.
- **Contención de errores.** Publicar diagnósticos nunca tumba el server; los fallos
  se loguean y se sigue.
- **Logs a stderr.** `--log-level` (`error|info|debug|trace`) y `--log-file`; stdout
  sólo lleva frames. Un test e2e verifica la pureza parseando *todo* stdout.
- **Tres niveles de test.** Unit (funciones puras), protocolo in-process (dos
  conexiones sobre `PassThrough`, sin subproceso) y e2e (spawn del binario + framing
  crudo). Los resultados que no cambian se congelan en **goldens** (`UPDATE_GOLDENS=1`
  los reescribe).

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/bin.ts` | Flags CLI; rechaza `--node-ipc`/`--socket` con exit 2; arranca el server. |
| `src/server.ts` | `initialize`, capabilities, config, shutdown, registro de handlers. |
| `src/documents.ts` | Mapa de documentos, caché por versión, debounce, publicar/limpiar. |
| `src/config.ts` | Settings con parseo defensivo (tipos incorrectos → default). |
| `src/log.ts` | Logger a stderr/archivo; nunca stdout. |
| `src/features/diagnostics.ts` | Core error → `Diagnostic` LSP. |
| `src/analysis/model.ts` + `positions.ts` | Pipeline y conversión de rangos. |
| `tests/protocol/harness.ts` | Cliente LSP in-process sobre streams. |
| `tests/protocol/golden.ts` | Comparación/actualización de goldens. |
| `tests/e2e/stdio.test.ts` | Framing crudo, pureza de stdout, `--version/--help`, transporte inválido. |

### Decisiones y límites

- `$/setTrace` por ahora sólo ajusta el log propio (marcado `ponytail:`); el forwarding
  por mensaje llega cuando se active la feature de tracer de la librería.
- Los goldens se generan con `UPDATE_GOLDENS=1`; en CI siempre se comparan.

### Cómo probarlo a mano

```sh
npm run build
node dist/bin.js --version
# En Neovim: :LspRestart y abrir un .placitum con un E301
```

---

## Fase 2 — Binder, tipos y checks estáticos

**Estado:**  completada.

### Objetivo

Entender el programa **como el evaluador lo entiende** (sin ejecutarlo) para reportar
errores que el core no ve: nombres sin resolver, redeclaraciones, tipos y aridades
seguros, y el chequeo `#!strict`.

### Conceptos

- **Scope y binding.** Un *scope* es un conjunto de nombres visibles (programa, fn,
  bloque, loop). Un *binding* es una declaración (`let`, `fn`, `param`, `iterator`,
  `builtin json`). Un *occurrence* es un uso: lectura o escritura (`x = 1`).
- **Pre-declaración (hoisting).** Las declaraciones de un scope se registran antes de
  recorrerlo: las closures resuelven nombres en tiempo de llamada, por eso
  `let y = z` seguido de `let z = 1` **no** es error. Excepción: el nombre de un `let`
  no es visible en su propio inicializador (`let x = x` → E500 si no hay un `x` externo).
- **E500 / E506.** E500: nombre no resoluble (lectura o asignación). E506:
  redeclaración en el mismo scope (incluye chocar con el builtin `json` y con params).
  Mensajes y hints son idénticos al core; hay fixtures eval-negativos copiados del repo
  core que lo prueban.
- **`TypeInfo`.** Inferencia best-effort: literales, arrays (elemento si es uniforme),
  objetos, namespace `json`, firmas de bangs (`fs.readFile! → string`, `curl! →
  {status, body}`), resultado de pipes. `unknown` se propaga y **nunca** se usa para
  reportar un error.
- **Checks "definitely-certain".** Sólo se reporta lo que falla en todo camino posible:
  literales incompatibles (`1 + "a"`), member sobre escalar, `json.parse` no-string,
  `for` sobre no-array, callee no invocable, aridad de fn/stdlib/bang (contando el
  valor que el pipe antepone), división por cero literal. Si hay duda, silencio.
- **E505 (`#!strict`).** Pre-pase del core que valida tipos de cadena de pipes. El
  pragma lo habilita; sin él, el colector devuelve vacío.
- **Capabilities del lenguaje.** El extractor produce el manifest: grants por categoría
  (`net`, `fsRead`, `fsWrite`, `exec`, `env`), manifests atenuados por fn (`scoped`),
  y `deferredToRuntime`. `capabilities.ts` responde: manifest efectivo en un offset,
  estado de un bang (`ambient`/`statically-covered`/`deferred`/`unknown`), grants crudos.
- **Gates de configuración.** `diagnostics.scope` (E500/E506), `strictChecks` (E505),
  `literalTypes` (E501–E504); se pueden apagar por separado.
- **Recuperación de parse.** Si hubo error de parse, el AST puede existir pero está
  incompleto: no se corren checks semánticos (evita cascadas).

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/analysis/binder.ts` | Scopes, bindings, occurrences, tipos, `bindingAt`, `nameSpanIn`. |
| `src/analysis/types.ts` | `TypeInfo` e `inferType` con resolver de nombres. |
| `src/analysis/checks.ts` | E501–E504 con mensajes del core. |
| `src/analysis/capabilities.ts` | Consultas sobre el manifest. |
| `src/analysis/comments.ts` | Trivia de comentarios (fallback por gaps de tokens). |
| `src/analysis/model.ts` | Ensambla binder/checks/strict/capabilities por documento. |
| `src/features/diagnostics.ts` | Une core + binder + checks, ordena por offset y aplica gates. |
| `tests/fixtures/binder/` | Fixtures eval-negativos copiados del core (E500/E506). |

### Decisiones y límites

- Los tipos son **por binding**, no flow-sensitive: `let x = 1; x = "a"` no re-tipa `x`
  (marcado `ponytail:`).
- La ocurrencia de escritura abarca sólo el identificador (`x`), no `x = 2`, para que
  rename/references sean correctos.

### Cómo probarlo a mano

```sh
# Un archivo con: let x = 1 / let x = 2 / let copy = missing_name / let s = 1 + "a"
# Deben aparecer E506, E500 y E501 con rangos exactos.
```

---

## Fase 3 — Navegación

**Estado:**  completada.

### Objetivo

Ir al origen de un nombre, listar usos, renombrar con seguridad y explorar símbolos
(documento y workspace).

### Conceptos

- **Definition vs. LocationLink.** `Location` es `{uri, range}`. `LocationLink` agrega
  `originSelectionRange` (lo que el usuario tenía bajo el cursor) y
  `targetSelectionRange` (el identificador destino, no toda la declaración). Si el
  cliente no soporta links, se devuelve `Location[]`.
- **Type definition.** Para bindings de usuario apunta a la declaración; para builtins
  (`json`) no hay archivo destino → `null`.
- **References.** Todas las occurrences del binding resuelto (lecturas y escrituras),
  más la declaración si el cliente pide `includeDeclaration`. Es single-file: Placitum
  no tiene módulos.
- **Rename scope-aware.** Se calculan los edits **desde el binder**, nunca por texto:
  renombrar un `x` interno no toca el `x` externo. `prepareRename` valida y devuelve el
  rango + placeholder; `rename` valida el nombre (`^[A-Za-z_][A-Za-z0-9_]*$`), rechaza
  keywords, colisiones en el mismo scope (mensaje E506) y nombres reservados. Los
  errores viajan como `ResponseError` para que el editor los muestre.
- **WorkspaceEdit.** Los cambios se devuelven como `{changes: {uri: TextEdit[]}}`; el
  servidor **nunca** escribe archivos.
- **DocumentSymbol vs SymbolInformation.** Jerárquico (`children`) si el cliente lo
  soporta; si no, lista plana con `containerName`. Kinds: `Namespace` (needs),
  `Function` (fn), `Variable` (let/param/iterador), `Property` (tokens de capability).
- **Workspace symbols sin índice persistente.** Se escanea `**/*.placitum` bajo los
  roots **on demand**, con cap (`maxFiles`), salteando `node_modules` y directorios
  ocultos, y caché por URI+mtime. Archivos a medio tipear caen a un regex de línea.
- **Registro dinámico de watchers.** Sólo si el cliente lo declara, se registra
  `workspace/didChangeWatchedFiles` para `**/*.placitum`; al notificar cambios se
  invalida la caché. Sin roots (`rootUri` null) → `[]`.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/features/definition.ts` | Definition/typeDefinition, links, propiedades de objetos literales. |
| `src/features/references.ts` | Locations de un binding. |
| `src/features/rename.ts` | prepare + rename con validaciones. |
| `src/features/symbols.ts` | Árbol de símbolos, flat, y extracción para workspace. |
| `src/workspace/files.ts` | Único lector de fs: scan con cap + caché mtime. |
| `src/server.ts` | Providers, `LocationLink` según capability, watcher e invalidación. |
| `tests/e2e/neovim.test.ts` | Rename real en Neovim headless (sombreado, sin corromper). |

### Decisiones y límites

- Definition de propiedades de objeto soporta sólo receptores que son bindings con
  inicializador de objeto literal (`ponytail:`: shapes encadenadas necesitarían
  guardar el origen de cada propiedad en `TypeInfo`).
- Los símbolos de bloques anidados se aplanan al símbolo contenedor más cercano (o al
  top level); el criterio es estable y está documentado en el código.
- El rename E2E usa la API actual de Neovim (`client:request`), no la deprecada.

### Cómo probarlo a mano

```sh
# Neovim: pararse en un nombre y usar gd / gr / <F2>; :lua =vim.lsp.buf.document_symbol()
# Zed: command palette -> "go to definition", "rename symbol", "document symbols".
```

---

## Fase 4 — Inteligencia

**Estado:**  completada.

### Objetivo

Hacer que el editor "entienda" el archivo mientras se escribe: completar, explicar con
hover, firmas, coloreado semántico, plegado, selección por rangos y resaltado de usos.

### Conceptos

- **Completion por contexto.** No hay una lista única: primero se clasifica dónde está
  el cursor (pragma, línea de `needs`, después de `fs.`, dentro de `only(`, dentro de
  `env(`, después de un `.`, después de `|`, o posición general) y recién ahí se eligen
  candidatos. El `!` de los bang calls no va en el `label`/`filterText` (rompería el
  filtrado) pero sí en el `insertText` como snippet (`fs.readFile!(${1})`).
  `sortText` ordena: `0` prefijo exacto o stage de pipe compatible, `1` locales,
  `2` builtins/keywords, `3` snippets. El `textEdit` reemplaza sólo el identificador
  parcial, nunca otro texto.
- **Hover.** Se devuelve `MarkupContent` (markdown) si el cliente lo declara; si no,
  texto plano. Los casos: bindings (tipo inferido + línea de declaración; para `fn`,
  firma y grants efectivos), `json`, propiedades de objetos, bang calls (cubierto /
  diferido / ambient con el grant que lo cubre), tokens de capability (categoría, uso,
  y grants del padre para `only(...)`), keywords y el pragma.
- **Signature help.** Se busca el paréntesis abierto más interno con una pila sobre el
  stream de tokens, se cuentan las comas de nivel 0 hasta el cursor (parámetro activo)
  y se resuelve el callee: fn de usuario visible → `BANG_SIGNATURES` → `PURE_SIGNATURES`.
  En un stage de pipe se antepone el parámetro `piped` porque en runtime el valor
  entrante es el argumento 0.
- **Semantic tokens.** La leyenda está congelada (`tokenTypes`/`tokenModifiers`). La
  clasificación prioriza spans del AST (bindings con `declaration`/`readonly`/
  `defaultLibrary`, usos, `modification` en escrituras, claves de objeto, `json.parse`,
  bang targets enteros) y cae al tipo de token para lo demás (keywords, strings,
  números, operadores, identificadores de `needs`). Los tokens adyacentes iguales se
  fusionan y se emiten como deltas ordenados, sin solapamientos.
- **Folding.** Rangos `region` para bloques y literales multilínea, `comment` para runs
  de comentarios, y un `region` por grupo de `needs` consecutivos. Si el parse falla,
  fallback de matching de llaves sobre tokens.
- **Selection ranges.** Cadena de ancestros del AST que contiene la posición
  (token → expresión → statement → bloque → fn → programa), con fallback token → línea
  → documento.
- **Highlights.** Ocurrencias del binding bajo el cursor: `Read` por defecto, `Write`
  para destinos de asignación; nada para builtins ni propiedades.
- **Parse recuperado.** Mientras se tipea, el parse suele fallar (binder `null`). Para
  que completion/hover/signature sigan funcionando hay fallbacks: detección de la línea
  `needs` por tokens, receiver de `.` desde el AST recuperado (o `json`), declaraciones
  `let`/`fn` recuperadas, y firmas de stdlib/bangs que no dependen del binder.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/features/completion.ts` | Contextos, snippets, sortText, fallbacks de parse recuperado. |
| `src/features/hover.ts` | Bindings, builtins, miembros, bangs, capability tokens, keywords. |
| `src/features/signature.ts` | Paréntesis activo, parámetro activo, prepend de pipe. |
| `src/features/semantic-tokens.ts` | Leyenda, clasificación AST-first y deltas. |
| `src/features/folding.ts` | Bloques/literales/comentarios/needs + fallback de llaves. |
| `src/features/selection.ts` | Cadena de ancestros y fallbacks. |
| `src/features/highlights.ts` | Reads/writes del binding. |
| `src/analysis/walk.ts` | `collectNodes`: recorrido genérico del AST. |
| `tests/fixtures/tokens.placitum` + golden | Fixture del golden de semantic tokens. |

### Decisiones y límites

- Los tokens semánticos nunca cruzan líneas (los bang targets no pueden); si un span
  fuera multilínea se omite porque el delta no puede expresarlo.
- El ranking de stages de pipe compara el primer parámetro con el tipo producido cuando
  es inferible; si no, se ofrece igual sin priorizar.
- **Helix** no está instalado en esta máquina: el check manual de completion/hover en
  Helix queda anotado para la Fase 6 (recetas + checklist). Neovim quedó automatizado.

### Cómo probarlo a mano

```sh
# Neovim: escribir "needs " y ver starters; "json." y ver parse; K sobre un binding.
# :lua =vim.lsp.buf.signature_help() dentro de una llamada.
# Coloreado: :set termguicolors + semantic tokens "combined" en Zed/Neovim.
```

### Gate

210 tests verdes, golden de semantic tokens (comentarios, pragma, bang targets,
identificadores de `needs`, f-strings) y E2E de Neovim con completion + hover markdown.

---

## Fase 5 — UX de capabilities

**Estado:**  completada.

### Objetivo

Cerrar el ciclo de la capability UX: arreglar lo que el analizador reporta (quick
fixes), explicarlo en el editor (code lens, inlay hints) y exponer el manifest real
(`placitum/manifest` + comandos).

### Conceptos

- **Quick fixes recomputados, nunca textuales.** Cada action se deriva del `Analysis`
  y de los diagnósticos recalculados, no del texto que manda el cliente: el fix es
  determinista y se entrega como `WorkspaceEdit` (el server jamás escribe archivos).
  `E101` inserta la comilla de cierre al final de línea, `E104` borra el whitespace
  entre el target y `!`, `E203` agrega `}` al EOF, `E500` declara con `let` (o define
  `fn name()` si el nombre es un callee) y `E506` renombra al primer `name_N` libre
  del scope.
- **Add-`needs` (la fix insignia).** Se localiza el `BangCall` por span, se calcula el
  token exactamente como lo haría el extractor (`net` con el hostname del `URL`
  lowercased, `\\` y `\"` re-escapados en paths) y se anexa `, <token>` al último
  `NeedsDecl` top-level, o se inserta `needs <token>` justo después del pragma / al
  offset 0. Si el token ya existe no se ofrece nada. Nunca toca un `needs` de fn en
  v1 (el top-level siempre es sound).
- **E303 fuera de alcance.** El fix "reemplazar por el grant que cubre" es
  inaplicable: el extractor aborta en E303, así que no hay manifest, y la propia
  semántica de atenuación garantiza que ningún token del scope padre cubre al hijo.
  Queda como el ítem opcional de la directiva.
- **Code lens.** Un lens por `NeedsDecl` top-level (`N grants · M deferred — show
  manifest`, con pluralización y `no grants` para cero) y uno por fn con `needs`
  (`needs only(...)` truncado a ~60 chars). Los conteos salen del manifest del
  extractor; si la extracción falló, se cuentan los tokens del AST. Sin parse no hay
  lens.
- **Inlay hints.** `: <tipo>` después de cada `let` con tipo inferido distinto de
  `unknown`/`null`; cobertura `needs ...` después de un bang sólo si
  `placitum.inlayHints.capabilities` está activo y el chequeo es
  `statically-covered` (nunca deferred/ambient). Se filtran por el rango pedido.
- **Manifest idéntico al core.** `placitum/manifest` devuelve
  `{ markdown, manifest, diagnostics }`; el markdown es `explain()` del core tal cual
  (cero re-render). Sin manifest, lista los diagnósticos y pide arreglar la causa
  (sintaxis vs. capabilities).
- **Comandos.** `placitum.showManifest` manda el markdown por `window/showMessage` con
  cap de 10 KB (el texto completo va al log); `placitum.reanalyze` re-analiza y
  republica; `placitum.addNeeds` aplica la fix del primer E301 vía
  `workspace/applyEdit`.
- **Tags de quick fix.** `data.quickFixes` en cada diagnóstico es la pista que el
  cliente puede mostrar; el handler igual recomputa el edit.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/features/code-actions.ts` | Quick fixes E101/E104/E203/E301/E500/E506 + action de comando. |
| `src/features/code-lens.ts` | Lentes de `needs` top-level y de fns atenuadas. |
| `src/features/inlay-hints.ts` | Tipos de `let` y cobertura de bangs. |
| `src/features/manifest-command.ts` | Payload de `placitum/manifest`, fallback y cap de mensaje. |
| `src/analysis/core-adapter.ts` | `explainManifest()` (renderer del core). |
| `src/features/diagnostics.ts` | `data.quickFixes` por código. |
| `src/server.ts` | Providers, `placitum/manifest`, `onExecuteCommand`. |
| `tests/fixtures/expected/manifest-rosetta.json` | Golden del payload completo. |

### Decisiones y límites

- El fix E303 de la directiva se omitió por inaplicable (ver Conceptos); era
  explícitamente opcional.
- `placitum.addNeeds` resuelve el **primer** E301 del documento: el extractor aborta
  en el primero, así que en la práctica es el único.
- `placitum.explainDeferred` no se implementó: el hover de bang ya muestra el motivo
  del deferral (y no está en el contrato de comandos de `initialize`).
- El code lens de un `needs` con extracción fallida muestra `0 deferred` (el
  extractor no llegó a poblarlos); los grants se cuentan del AST.

### Gate

246 tests verdes; `placitum/manifest` idéntico byte a byte al `explain` del core para
Rosetta (test unitario contra el core + golden del payload); add-needs cubierto en
sus seis variantes (sin needs, con needs, pragma, duplicado, hostname lowercased,
escaping).

### Cómo probarlo a mano

```sh
# Neovim: en un bang sin cobertura, :lua vim.lsp.buf.code_action() -> Add needs ...
# :lua vim.lsp.buf.code_lens() en un needs; :PlacitumManifest para el manifest.
# Inlay hints: habilitar placitum.inlayHints.enable en la config del cliente.
```

---

## Fase 6 — Compatibilidad

**Estado:**  completada (la verificación manual en editores no instalados queda
documentada como pendiente, no simulada).

### Objetivo

Garantizar que el server sea útil con el cliente más pobre posible y dejar recetas
copy-paste por editor, con una matriz de compatibilidad honesta.

### Conceptos

- **Contrato mínimo.** `initialize` + `didOpen`/`didChange`/`didClose` +
  `publishDiagnostics` alcanzan; el resto es opcional y se degrada. El server
  declara `positionEncoding: utf-16` y nunca negocia otra codificación.
- **Fallbacks capability-por-capability.** Sin `linkSupport` → `Location[]`; sin
  `hierarchicalDocumentSymbolSupport` → `SymbolInformation[]` con
  `containerName`; sin `contentFormat` → hover string; sin
  `workspace.configuration` → `initializationOptions`/defaults (no se manda el
  request); sin `dynamicRegistration` → no se registra el watcher; sin root →
  `workspace/symbol` devuelve `[]`; request desconocido → `MethodNotFound`
  (-32601) sin tumbar la conexión.
- **UTF-16 como contrato duro.** Un emoji cuenta 2 unidades; el test de
  compatibilidad fija el rango de un E500 después de un astral.
- **Matriz de editores.** `docs/COMPATIBILITY.md` cruza feature × cliente y
  `docs/EDITOR-CHECKLIST.md` registra fecha + versión por cliente. Neovim está
  automatizado; el resto queda `pending` con los pasos exactos, sin inventar
  resultados.
- **Recetas lint-checked.** JSON con `JSON.parse`, Lua con `loadfile` de Neovim
  (`nvim --headless -u NONE`), TOML con un chequeo estructural (en esta máquina
  no hay parser TOML) y elisp sin tooling disponible (revisado a mano).
- **E2E por la receta real.** El E2E de Neovim usa
  `nvim -u editors/neovim/init.lua` con un shim de `placitum-lsp` en `PATH`, así
  que prueba la receta publicada, no una configuración ad-hoc.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `tests/protocol/compatibility.test.ts` | Cliente mínimo, fallbacks, no-registration, root null, config, UTF-16. |
| `tests/e2e/neovim.test.ts` | E2E con la receta: rename, completion+hover, E301 + manifest. |
| `tests/e2e/recipes.test.ts` | Lint de recetas (JSON/Lua/TOML) + tabla del README. |
| `editors/neovim/` | `init.lua` (0.11+) y `nvim-lspconfig.lua` (0.10). |
| `editors/{helix,emacs,zed,sublime,vim,kate}/` | Recetas copy-paste por cliente. |
| `editors/README.md` | Tabla cliente → receta → versión → ¿automatizado? + checklist. |
| `docs/COMPATIBILITY.md` | Matriz capability-por-capability y por editor, con límites. |
| `docs/EDITOR-CHECKLIST.md` | Registro manual por cliente (fecha + versión). |

### Decisiones y límites

- La verificación se ejecutó con instalaciones temporales de Nix (`nix shell` /
  `nix build`, nada agregado al repo): Helix 25.07.1 (E301, hover, completion,
  rename scope-aware y manifest vía `:lsp-workspace-command`), Emacs 31.1 con
  eglot (E500, hover plaintext, completion, rename) y con lsp-mode (conexión, 19
  capabilities, hover markdown), Vim + vim-lsp 0.1.4 (server `running`, E500) y
  Neovim 0.10.2 + nvim-lspconfig (attach + E500). Fechas, versiones y comandos
  en `docs/EDITOR-CHECKLIST.md`.
- Zed, Kate, Sublime y coc.nvim quedan `pending`: no tienen superficie headless
  (GUI o falta de paquete en nixpkgs) y no se reportaron como verificados.
- Bug real encontrado al probar Helix: `executeCommand` sin argumentos (los
  palettes mandan la lista vacía) no hacía nada. El server ahora cae al único
  documento abierto si no recibe URI; test en `capabilities.test.ts`.
- Los quick fixes requieren `codeActionLiteralSupport` (universal desde LSP 3.8);
  no se agrega el fallback a `Command[]` porque un `Command` no puede transportar
  el `WorkspaceEdit`.
- Sublime (paquete LSP) no consume semantic tokens y Kate no los pide: la matriz
  lo dice explícitamente en vez de asumir paridad.
- Helix y Zed necesitan un grammar tree-sitter para highlighting; las features
  LSP no dependen de él (Helix lo reporta como `✘` en `hx --health`).

### Gate

Matriz en `docs/COMPATIBILITY.md` + checklist por editor; todas las recetas
lint-checked; E2E de Neovim (incluida la receta) verde.

---

## Fase 7 — Release

**Estado:**  parcial. Hecho: `LICENSE` MIT (`The Placitum Authors`) en `pl-lsp` y
`pl-lg` (commit `fd2dc7a`), `AUTHORS` con los tres contribuidores, `CHANGELOG`,
metadata, snapshot de empaquetado, smoke de tarball en máquina limpia, README
final, `docs/VSCODE-HANDOFF.md` completo y pin del core actualizado a
`fd2dc7af10e759efed773934dba6f3c02e592014`. Pendiente: la revisión del handoff
+ `vsce package`, que son del repo del teammate.

### Objetivo

Que el paquete se pueda empaquetar, instalar y ejecutar en una máquina limpia, y
dejar la spec exacta para la extensión de VS Code sin tocar su repositorio.

### Conceptos

- **Empaquetado npm.** `files` decide el tarball (`dist` + `editors` + docs);
  `private: true` bloquea `npm publish` pero no `npm pack`; `bin` mapea
  `placitum-lsp` y `exports` expone `dist/server.js` para el teammate.
- **Fresh-machine simulation.** `npm pack` → `npm install <tgz>` en un directorio
  temporal → `--version` / `--help` → E2E crudo (framing propio, `initialize`,
  `didOpen`, E301, `shutdown`/`exit`) con verificación de pureza de stdout y
  código de salida 0.
- **Snapshot de contenidos.** Un test corre `npm pack --dry-run --json` y afirma
  que el tarball incluye `dist/`, `editors/`, README y CHANGELOG, y que nunca
  filtra `src/`, `tests/`, `scripts/` ni configs.
- **Handoff como contrato.** `docs/VSCODE-HANDOFF.md` describe el esqueleto de la
  extensión, el arranque del cliente, el bundling del server + core, una gramática
  TextMate semilla, la language configuration, los comandos y el checklist de
  aceptación. El server no sabe de VS Code: el teammate no toca este repo.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `CHANGELOG.md` | Keep a Changelog, entrada 0.1.0 con el ciclo completo (fases 0–6). |
| `scripts/smoke-pack.mjs` | Tarball + install temporal + `--version/--help` + E2E crudo. |
| `tests/e2e/pack.test.ts` | Snapshot de `npm pack --dry-run --json` (incluye/excluye). |
| `docs/VSCODE-HANDOFF.md` | Spec completa de la extensión (teammate). |
| `package.json` | Metadata (`repository`/`homepage`/`bugs`/`keywords`), `smoke:pack` y `ci` extendido. |

### Decisiones y límites

- `smoke:pack` requiere red (instala el core desde npm) y tarda ~35 s; por eso
  cierra `npm run ci` pero `npm test` no lo corre. En una máquina sin red, usar
  `npm test`.
- **LICENSE resuelto**: MIT con titular colectivo `The Placitum Authors` en ambos
  repos, más un `AUTHORS` con los contribuidores (documenta el titular sin tocar
  la licencia cuando se sume gente). MIT no se registra en ningún lado: el
  archivo `LICENSE` + el campo `"license": "MIT"` son la concesión. El paquete
  sigue `private` (eso bloquea publicar, no licenciar).
- **El core se publicó en npm** (`placitum@1.0.0`, 2026-09-23) y pl-lsp migró de
  `github:quesadx/pl-lg#sha` a `"placitum": "^1.0.0"`. Se ajustaron
  `CORE_API_VERSION` (ahora versión, no SHA), `check-deps` (exige semver),
  `docs/CORE-VERSION.md`, los fixtures del binder y el test del adapter (verifica
  que coincida con la versión instalada). Ya no hay hashes que copiar: actualizar
  es `npm update placitum`.
- Se eliminó una autodependencia accidental `"placitum": "github:quesadx/pl-lg#…"`
  en el `package.json` del core: rompía `check-deps` y ningún archivo la usaba.
- La revisión final del handoff y el `vsce package` pertenecen al repositorio de
  la extensión (teammate); acá queda la spec completa y verificable.

### Gate

`npm run ci` verde (266 tests + smoke de empaquetado), snapshot de contenidos
verde y handoff completo. La firma externa (teammate) y la licencia quedan
explícitamente pendientes.

### Cómo probarlo

```sh
npm run build
npm pack --dry-run          # contenidos del tarball
npm run smoke:pack          # install en dir temporal + E2E crudo (requiere red)
```

---

## Fase 8 — Futuro opcional (parcial)

**Estado:**  4 de 6 ítems completos, pedidos explícitamente: multi-root workspace
symbols, pull diagnostics, delta de semantic tokens y **publicación a npm**
(`placitum@1.0.0` en pl-lg, `placitum-lsp@0.1.0` en pl-lsp). Pendientes:
grammar tree-sitter y binario standalone (cada uno con su propio gate).

### Conceptos

- **Multi-root.** `workspace/didChangeWorkspaceFolders` actualiza los roots y
  resetea el índice (que se reconstruye on demand). Con más de un root, el
  `containerName` se prefija con la carpeta (`mi-lib/x.placitum`) para
  desambiguar archivos homónimos. El cap y la caché por mtime siguen igual.
- **Pull diagnostics (LSP 3.17).** `textDocument/diagnostic` devuelve un report
  `full` con `resultId` (`v<versión>:<gates de config>`); si el cliente manda un
  `previousResultId` que coincide, se responde `unchanged` sin recalcular. El
  provider se anuncia **solo** si el cliente declara `textDocument.diagnostic`;
  el resto sigue con push. Los handlers pull usan `freshAnalysis` (recalcula si
  la versión cacheada quedó vieja) para no responder datos stale tras un cambio.
- **Delta de semantic tokens.** `full: { delta: true }` con `resultId` por
  versión. La primera respuesta es full; con `previousResultId` válido se manda
  un único edit mínimo (prefijo/sufijo común en tokens de 5 números). Sin base o
  con resultId viejo, se responde full. La caché se limpia al cerrar el documento.
- **Publicación a npm.** El core se publicó como `placitum@1.0.0` y pl-lsp como
  `placitum-lsp@0.1.0`; la dependencia pasó del SHA de git a `^1.0.0` de registry.
  Cada repo tiene workflows `CI` (push/PR) y `Release` (tags `v*` +
  `workflow_dispatch`) con `--provenance --access public`; los tokens van como
  secret `NPM_TOKEN` (o Trusted Publishing, sin token, para las próximas). El
  `prepublishOnly` corre el gate `verify` (sin el smoke anidado, que rompía el
  `npm publish --dry-run`); el smoke queda en `ci` y en el workflow de release.

### Qué se construyó

| Archivo | Responsabilidad |
|---|---|
| `src/features/diagnostics.ts` | `documentDiagnostic()` + `diagnosticResultId()`. |
| `src/features/semantic-tokens.ts` | `semanticTokensDelta()` + `semanticTokensResultId()`. |
| `src/documents.ts` | `freshAnalysis()` para requests pull. |
| `src/workspace/files.ts` | `containerName` con prefijo de carpeta en multi-root. |
| `src/server.ts` | Handler de carpetas, pull diagnostics, delta + caché, capability condicional. |

### Decisiones y límites

- Push y pull coexisten: el cliente elige. Los que declaran pull reciben
  `diagnosticProvider`; el resto sigue con `publishDiagnostics`.
- El contrato §7.1 original anunciaba `semanticTokensProvider.full: true`; ahora
  es `{ delta: true }` (requisito para deltas). Documentado acá y en
  `docs/COMPATIBILITY.md`.
- El delta es un solo edit por respuesta (prefijo/sufijo), no una secuencia
  mínima óptima: suficiente y determinista; `ponytail:` si algún cliente mide el
  ancho de banda, cambiar a LCS.
- Multi-root no deduplica archivos entre roots solapados ni pagina el cap por
  carpeta; el cap sigue siendo global.

### Gate

274 tests verdes (unit + protocolo + e2e + smoke de empaquetado), incluyendo:
report pull full/unchanged/refresh, delta que reconstruye el stream y fallback a
full, y alta de carpeta con prefijo de `containerName`.

### Cómo probarlo

```sh
npx vitest run tests/protocol/compatibility.test.ts   # pull + multi-root
npx vitest run tests/protocol/intelligence.test.ts    # full + delta
npm view placitum-lsp version                         # 0.1.0 en el registry
npx placitum-lsp --version                            # instalado desde npm
```

---

## Cómo se cierra cada fase

1. `npm run ci` verde (check-deps → typecheck → lint → build → tests).
2. Fixtures/goldens nuevos commiteados.
3. `dist/` recompilado y `:LspRestart` en el editor para probar a mano.
4. Este documento actualizado con la fase cerrada.
