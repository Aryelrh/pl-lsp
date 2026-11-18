# Desarrollo y publicación de Placitum para VS Code

Guía operativa de `pl-vscode`: entorno, ciclo de desarrollo, pruebas, empaquetado
y publicación en Visual Studio Marketplace.

Las instrucciones de publicación siguen la documentación oficial de Microsoft,
consultada el **17 de noviembre de 2026**. Los enlaces están en
[Referencias oficiales](#11-referencias-oficiales).

> **Aviso vigente:** el 1 de diciembre de 2026 Azure DevOps retira los Personal
> Access Tokens (PAT) globales. Para releases nuevos usá identidad federada:
> **Trusted Publishing** en GitHub Actions o **Managed Identity** en Azure
> Pipelines. La sección de PAT queda solo como referencia histórica.

## 0. Flujo de un release (resumen)

1. Actualizar las versiones fijadas de `placitum` y `placitum-lsp`.
2. Re-bundlear el server, actualizar `CHANGELOG.md` y `THIRD-PARTY-NOTICES.md`.
3. Subir la versión de la extensión en `package.json`.
4. Correr build, smoke tests y `vsce package`.
5. Commit, tag `vX.Y.Z` y push del tag.
6. El pipeline publica el `.vsix` con identidad federada.
7. Verificar la ficha del Marketplace e instalar desde ahí.

## 1. Requisitos

| Herramienta / cuenta | Para qué |
|---|---|
| Node.js 22 | `@vscode/vsce` exige Node 22 o superior; el repo fija Node 22 vía Nix |
| VS Code 1.90+ | La extensión declara `engines.vscode: ^1.90.0` |
| Cuenta Microsoft | Acceso al publisher `placitum` en el Marketplace |
| Acceso al publisher | Publicar; el ID del publisher no se puede cambiar |
| Repo en GitHub o Azure DevOps | Publicación automatizada con identidad federada |

No hace falta instalar `placitum` ni `placitum-lsp` globalmente: el server y el
CLI viajan bundleados dentro de la extensión.

## 2. Preparar el entorno

El host de desarrollo puede no tener `node`/`npm` en el `PATH`; el repo trae un
dev shell de Nix con Node 22.

```bash
cd pl-vscode

# Dependencias exactas del lockfile
nix develop --command npm ci

# Bundle del language server + CLI dentro de server/dist/
nix develop --command npm run bundle:server

# Compilar la extensión TypeScript a out/
nix develop --command npm run build
```

Si tu máquina ya tiene Node 22, podés omitir `nix develop --command` y usar
`npm` directamente.

`server/dist/` y `out/` están en `.gitignore`: después de un clone limpio hay que
generarlos antes de probar o empaquetar. `npm run package` los regenera solo
(ver [`vscode:prepublish`](#5-empaquetar-e-instalar-localmente)).

## 3. Ciclo de desarrollo

### 3.1 Extension Development Host

1. Abrí la carpeta `pl-vscode/` en VS Code.
2. Presioná **F5** o elegí **Run and Debug → Run Placitum Extension**
   (`/.vscode/launch.json`).
3. Se abre una ventana **Extension Development Host** con la extensión cargada.
4. Abrí una carpeta con un archivo `.placitum` y aceptá **Trust** (el comando
   de ejecución está deshabilitado en workspaces no confiables).

Archivo mínimo para probar:

```placitum
let x = 1
print!(x)
```

Qué verificar en esa ventana:

- Coloreado, brackets y comentarios (`#`).
- Diagnósticos del server (por ejemplo, un `E301` al leer una capability sin
  `needs`).
- Completion, hover, rename, code lens y quick fixes.
- **Placitum: Run file** en la barra del editor o en la paleta de comandos.
- **Placitum: Show capability manifest**, **Reanalyze file** y
  **Add missing needs**.

### 3.2 Recompilar durante el desarrollo

```bash
# Compilación incremental mientras editás src/
nix develop --command npm run watch
```

Después de recompilar, en la ventana del Extension Development Host ejecutá
**Developer: Reload Window**. Los cambios de gramática o de
`language-configuration.json` también requieren recargar la ventana.

### 3.3 Cambios en el language server

La extensión consume versiones **publicadas en npm** de `placitum-lsp` y
`placitum`, no las carpetas hermanas. Para probar un cambio del server:

```bash
# En pl-lg/: si cambió el core, publicar placitum primero
# (prepublishOnly corre typecheck, lint, build y tests)
cd ../pl-lg
nix develop --command npm publish

# En pl-lsp/: publicar el server
cd ../pl-lsp
nix develop --command npm publish

# En pl-vscode/: fijar las versiones nuevas y re-bundlear
cd ../pl-vscode
nix develop --command npm install --save-dev --save-exact \
  placitum@<versión> placitum-lsp@<versión>
nix develop --command npm run bundle:server
nix develop --command npm run build
```

Mantené `placitum`, `placitum-lsp` y la extensión en lockstep: si sube el server,
re-bundleá y repetí el checklist de pruebas.

## 4. Pruebas

| Comando | Qué valida | Requiere |
|---|---|---|
| `npm run smoke:server` | El bundle LSP responde JSON-RPC por stdio (E301, settings, manifest, reanalyze) | `bundle:server` |
| `npm run smoke:cli` | El CLI bundleado ejecuta un script | `bundle:server` |
| `npm run test:guard` | Guards del comando Run (workspace confiable, lenguaje, scheme) | compila solo |
| `npm run smoke:wrapper` | La terminal queda abierta hasta una tecla | `build` + `bundle:server` |
| `npm run package` | Genera el `.vsix` | todo (lo construye) |

Secuencia completa antes de publicar:

```bash
nix develop --command bash -c '
  npm ci &&
  npm run bundle:server &&
  npm run build &&
  npm run smoke:server &&
  npm run smoke:cli &&
  npm run test:guard &&
  npm run smoke:wrapper &&
  npm run package
'
```

`test:guard` vuelve a compilar; no es un problema, solo tarda un poco más.

Prueba manual imprescindible: instalar el `.vsix` en un VS Code limpio (sin
`placitum-lsp` global) y confirmar diagnósticos, completion, hover, rename,
manifiesto y ejecución.

## 5. Empaquetar e instalar localmente

```bash
nix develop --command npm run package
```

Esto ejecuta `vscode:prepublish` (`bundle:server` + `build`) y después
`vsce package`. Genera `placitum-vscode-<versión>.vsix` en la raíz del repo.

Instalar el VSIX:

- **UI:** Extensions → `...` → **Install from VSIX...**.
- **CLI:**

```bash
code --install-extension placitum-vscode-<versión>.vsix
```

Verificar que el paquete lleva lo necesario:

```bash
unzip -l placitum-vscode-<versión>.vsix \
  | grep -E 'extension/(out/|server/dist/|THIRD-PARTY-NOTICES)'
```

Deben aparecer `out/extension.js`, `out/run-wrapper.js`,
`server/dist/bin.js`, `server/dist/placitum.js` y las licencias. `.vscodeignore`
excluye fuentes, scripts, tests y `docs/`; las `devDependencies` se excluyen
solas.

El `.vsix` también sirve para distribuir la extensión sin publicarla.

## 6. Versionado y actualización de dependencias

La versión vive en `package.json`. El tag debe ser exactamente `vX.Y.Z`.

```bash
# 1. Fijar las versiones nuevas del core y del server (sin ^ ni ~)
nix develop --command npm install --save-dev --save-exact \
  placitum@<versión> placitum-lsp@<versión>

# 2. Re-bundlear y compilar
nix develop --command npm run bundle:server
nix develop --command npm run build

# 3. Subir la versión de la extensión sin crear commit ni tag todavía
nix develop --command npm version <X.Y.Z> --no-git-tag-version
```

Además:

- Actualizá `CHANGELOG.md` (formato Keep a Changelog, sección `Unreleased` a
  versión nueva).
- Actualizá las versiones de `THIRD-PARTY-NOTICES.md`.
- El Marketplace **no acepta dos publicaciones con la misma versión**.

## 7. Publicación en Visual Studio Marketplace

### 7.1 Crear o verificar el publisher

Fuente oficial: [Create a publisher](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher).

1. Entrá a <https://marketplace.visualstudio.com/manage> con la cuenta
   Microsoft que va a administrar la extensión.
2. **Create publisher**.
3. Completá **ID** y **Name**:
   - **ID**: identificador único y definitivo; para este repo debe ser
     `placitum`, igual que `publisher` en `package.json`.
   - **Name**: nombre visible (por ejemplo, Placitum).
4. Guardá con **Create**.

El ID del publisher no se puede cambiar después. Si `placitum` ya existe y no
es tuyo, la publicación va a fallar; hay que corregir `publisher` en
`package.json` o usar el publisher correcto.

### 7.2 Requisitos del paquete

Antes de publicar, `package.json` debe tener:

- `name`, `displayName`, `description`, `version` y `publisher`.
- `engines.vscode` (`^1.90.0` en este repo).
- `README.md`, `LICENSE` y `CHANGELOG.md` en la raíz.
- `keywords`: máximo 30 (límite del Marketplace).
- `icon`: PNG de al menos 128×128. Este repo usa `icon.png` (variante
  redondeada del logo).
- `repository` correcto para que los enlaces relativos del README funcionen.

Restricciones del Marketplace que valida `vsce`:

- El icono no puede ser SVG.
- Los badges e imágenes del README/CHANGELOG deben ser HTTPS y no SVG, salvo
  proveedores de badges aprobados.

### 7.3 Opción A — GitHub Actions + Trusted Publishing (recomendada)

Fuente oficial: [Publish with GitHub Actions and Trusted Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing).

No guarda secretos: GitHub emite un token OIDC y el Marketplace lo canjea por
una credencial temporal.

**Paso 1 — Crear la política en el Marketplace**

1. Entrá a <https://marketplace.visualstudio.com/manage>.
2. Abrí el publisher `placitum`.
3. Elegí **Trusted Publishing** → **Create**.
4. Completá:
   - **Policy name**: por ejemplo `Release workflow`.
   - **Repository owner**: `montoshitaa`.
   - **Repository**: `pl-vscode`.
   - **Workflow**: `publish.yml` (el nombre del archivo en `.github/workflows`).
   - **Environment**: vacío, salvo que el workflow use un environment.
5. **Create**.

**Paso 2 — Agregar el workflow**

Creá `.github/workflows/publish.yml`:

```yaml
name: Publish extension

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # requerido por Trusted Publishing
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Check tag matches package version
        run: test "${GITHUB_REF_NAME#v}" = "$(node -p "require('./package.json').version")"

      - run: npm ci
      - run: npm run bundle:server
      - run: npm run build

      - run: npm run smoke:server
      - run: npm run smoke:cli
      - run: npm run test:guard
      - run: npm run smoke:wrapper

      - run: npx @vscode/vsce publish --oidc
```

`vsce publish` ejecuta `vscode:prepublish` y vuelve a bundlear/compilar; los
tests corren antes para no publicar un paquete roto.

**Paso 3 — Publicar**

```bash
git add .
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Notas oficiales:

- La credencial del Marketplace dura 15 minutos.
- Cada token OIDC de GitHub se puede canjear una sola vez.
- En repos privados, el primer workflow debe correr dentro de las 48 horas de
  creada la política para activarla.

### 7.4 Opción B — Azure Pipelines + Managed Identity

Fuente oficial: [Publish from Azure Pipelines with Microsoft Entra ID](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-from-azure-pipelines-with-microsoft-entra-id).

Este repo ya trae `azure-pipelines.yml` con esa vía. Configuración inicial
(una sola vez, según la guía oficial):

1. **Service connection** en Azure DevOps: *Project Settings → Service
   Connections → Azure Resource Manager → Workload Identity Federation
   (manual)*. En este repo se llama `placitum-marketplace`.
2. **Managed identity** user-assigned en Azure, con rol **Reader**. Anotá
   Client ID, Tenant ID y suscripción.
3. **Federated credential** entre la service connection y la managed identity
   (intercambiar issuer/subject y client/tenant/subscription; **Verify and
   save**).
4. Dar acceso de la service connection a los pipelines que publican.
5. Obtener el **resource ID** de la identidad con una tarea `AzureCLI@2` y el
   endpoint de perfiles (ver la guía oficial).
6. En el Marketplace, agregar esa managed identity como miembro del publisher
   con rol **Contributor**.
7. En el pipeline, publicar con `vsce publish --azure-credential`
   (`vsce` >= 2.26.1).
8. El pipeline debe correr sobre un tag `vX.Y.Z` y verificar que coincida con
   `package.json`.

El YAML del repo ya hace:

- Trigger por tags `v*` (y PR a `dev`/`main`).
- Chequeo `tag == package.json.version`.
- `npm ci` + `npm run package` + los cuatro smoke tests.
- Verificación de que el VSIX contiene server, CLI, wrapper y `server/package.json`.
- Publicación con `vsce publish --azure-credential --packagePath ... --skip-duplicate`
  bajo `AzureCLI@2`.

Antes del primer release con esta vía, confirmá que la service connection
`placitum-marketplace` existe, que la managed identity es miembro del publisher
y que el pipeline tiene permiso para usarla.

### 7.5 Opción C — Publicación manual del VSIX

No requiere PAT ni CI; sirve si todavía no configuraste identidad federada.

```bash
nix develop --command npm run package
```

1. Entrá a <https://marketplace.visualstudio.com/manage>.
2. Abrí el publisher `placitum`.
3. **New extension → Visual Studio Code** y subí el `.vsix`.
4. Completá la ficha y publicá.

Es la misma vía que documenta Microsoft como *manually, using `vsce package` ...
and then uploading it to the publisher management page*.

### 7.6 PAT (heredado, no recomendado)

La guía oficial todavía describe los PAT, pero los marca como **Not
Recommended** y los retira el **1 de diciembre de 2026**. No los uses para un
release nuevo.

Si necesitaras el flujo antiguo antes de esa fecha: crear un PAT en Azure
DevOps con organización **All accessible organizations** y scope
**Marketplace → Manage**, y autenticar con `vsce login placitum`. Un PAT con
organización específica o scope incorrecto produce 401/403.

## 8. Checklist de release

```bash
cd pl-vscode
git pull

# 1. Dependencias y bundle
nix develop --command npm install --save-dev --save-exact \
  placitum@<versión> placitum-lsp@<versión>
nix develop --command npm run bundle:server
nix develop --command npm run build

# 2. Versión, CHANGELOG y THIRD-PARTY-NOTICES actualizados a mano
nix develop --command npm version <X.Y.Z> --no-git-tag-version

# 3. Pruebas
nix develop --command bash -c '
  npm run smoke:server &&
  npm run smoke:cli &&
  npm run test:guard &&
  npm run smoke:wrapper
'

# 4. Paquete y verificación
nix develop --command npm run package
unzip -l placitum-vscode-<X.Y.Z>.vsix \
  | grep -E 'extension/(out/|server/dist/|THIRD-PARTY-NOTICES)'

# 5. Commit y tag
git add .
git commit -m "release: v<X.Y.Z>"
git tag v<X.Y.Z>
git push origin main
git push origin v<X.Y.Z>
```

Al hacer push del tag:

- **GitHub Actions:** corre `publish.yml` y publica con `--oidc`.
- **Azure Pipelines:** corre `azure-pipelines.yml`, valida el tag, empaqueta,
  prueba y publica con managed identity.

## 9. Verificación post-publicación

1. Abrí la ficha:
   `https://marketplace.visualstudio.com/items?itemName=placitum.placitum-vscode`.
2. Confirmá versión, README, CHANGELOG y licencia.
3. Instalá desde el Marketplace en un VS Code limpio:

   ```bash
   code --install-extension placitum.placitum-vscode
   ```

4. Verificá la versión en Extensions y repetí la prueba funcional:
   diagnósticos, completion, hover, rename, manifiesto y **Run file**.
5. Revisá **Acquisition Trend** y **Ratings & Reviews** en el publisher
   management page.

La propagación del Marketplace puede tardar unos minutos.

## 10. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `401` o `403` al publicar | En PAT: organización debe ser **All accessible organizations** y scope **Marketplace (Manage)**. Con Trusted Publishing: la política debe coincidir exactamente con owner, repo, workflow y environment. |
| No pide credencial y falla en CI | Falta `--oidc` (GitHub) o `--azure-credential` (Azure), o falta `id-token: write`. |
| `The extension 'name' already exists` | `name` y `displayName` deben ser únicos en el Marketplace. |
| `Version already exists` | Subí la versión; no se puede republicar la misma. |
| El pipeline no corre al pushear el tag | Revisá el trigger de tags en `azure-pipelines.yml` o el filtro `tags` del workflow. |
| `Check tag matches package version` falla | El tag debe ser `v` + exactamente `package.json.version`. |
| El VSIX no incluye el server | Faltó `npm run bundle:server` o `.vscodeignore` excluyó `server/dist`. |
| `You exceeded the number of allowed tags of 30` | Reducí `keywords` a 30 o menos. |
| Error por SVG | El icono debe ser PNG; badges/imágenes SVG solo de proveedores aprobados. |
| `vsce` falla por Node | Usá Node 22 (dev shell de Nix). |
| **Run file** no aparece | Workspace no confiable: aceptá **Trust**, o el archivo no es `.placitum` local/remoto. |
| `code` no se reconoce | Instalá el comando `code` desde VS Code o usá **Install from VSIX...** en la UI. |

## 11. Referencias oficiales

Documentación de Microsoft (fuente de las instrucciones de publicación):

- Publicar extensiones: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- Integración continua y publicación automatizada: <https://code.visualstudio.com/api/working-with-extensions/continuous-integration>
- Probar extensiones: <https://code.visualstudio.com/api/working-with-extensions/testing-extension>
- Bundling de extensiones: <https://code.visualstudio.com/api/working-with-extensions/bundling-extension>
- Manifiesto de extensión: <https://code.visualstudio.com/api/references/extension-manifest>
- Language Server Extension Guide: <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
- Gestión de publishers y extensiones: <https://marketplace.visualstudio.com/manage>
- `@vscode/vsce`: <https://github.com/microsoft/vscode-vsce>
- Retiro de PAT globales (blog de Microsoft DevOps): <https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/>

Documentación interna del repo:

- [`../README.md`](../README.md) — características, settings y comandos.
- [`../CHANGELOG.md`](../CHANGELOG.md) — historial de versiones.
- [`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) — licencias del core,
  server y dependencias bundleadas.
