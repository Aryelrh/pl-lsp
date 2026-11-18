# Placitum

![Logotipo de Placitum](placitum-logo-set/svg/placitum-rounded.svg)

**Documentación del proyecto**  
**Lenguaje · servidor de lenguaje · extensión de VS Code**

**Universidad Nacional — Sede Regional Brunca**  
**Campus Pérez Zeledón**  
**Curso:** Paradigmas de Programación  
**Profesores:** Pablo A. Venegas Elizondo · Josias Ariel Chaves Murillo

**Integrantes:**  
Matteo Vargas  
Kristel Montoya  
Aryel Rivera

**Versiones:** núcleo `placitum` 1.0.1 · servidor `placitum-lsp` 0.1.1 · extensión `placitum-vscode` 0.1.3  
**Fecha:** noviembre de 2026

---

## Tabla de contenidos

- [Resumen](#resumen)
- [1. Introducción](#1-introducción)
- [2. Planteamiento del problema](#2-planteamiento-del-problema)
  - [2.1 Problema y motivación](#21-problema-y-motivación)
  - [2.2 A quiénes afecta](#22-a-quiénes-afecta)
  - [2.3 Contexto](#23-contexto)
  - [2.4 Soluciones existentes y sus limitaciones](#24-soluciones-existentes-y-sus-limitaciones)
  - [2.5 Evidencias de investigación](#25-evidencias-de-investigación)
  - [2.6 Aporte de Placitum](#26-aporte-de-placitum)
- [3. Propuesta de solución](#3-propuesta-de-solución)
- [4. Objetivos](#4-objetivos)
- [5. Alcance y limitaciones](#5-alcance-y-limitaciones)
- [6. Descripción del lenguaje](#6-descripción-del-lenguaje)
- [7. Palabras reservadas](#7-palabras-reservadas)
- [8. Sintaxis](#8-sintaxis)
- [9. Semántica](#9-semántica)
- [10. Tipos de datos](#10-tipos-de-datos)
- [11. Funciones](#11-funciones)
- [12. Estructuras de control](#12-estructuras-de-control)
- [13. Operaciones](#13-operaciones)
- [14. Organización de archivos](#14-organización-de-archivos)
- [15. Importaciones](#15-importaciones)
- [16. Proceso de compilación y análisis](#16-proceso-de-compilación-y-análisis)
- [17. Proceso de ejecución](#17-proceso-de-ejecución)
- [18. Manejo de errores](#18-manejo-de-errores)
- [19. Innovación](#19-innovación)
- [20. Arquitectura del aplicativo](#20-arquitectura-del-aplicativo)
- [21. Servidor de lenguaje (LSP)](#21-servidor-de-lenguaje-lsp)
- [22. Ciclo de desarrollo](#22-ciclo-de-desarrollo)
- [23. Pruebas](#23-pruebas)
- [24. Contribuciones de los integrantes](#24-contribuciones-de-los-integrantes)
- [25. Conclusiones](#25-conclusiones)
- [26. Referencias](#26-referencias)
- [27. Anexos](#27-anexos)

---

## Resumen

Placitum es un lenguaje de scripting orientado a shell con **capabilities**: cada
script declara en una cláusula `needs` qué archivos, hosts y variables de entorno
puede tocar. Los usos con argumentos literales se verifican estáticamente antes
de ejecutar; el resto se controla en runtime con un guard. No existe acceso
ambiental implícito al sistema de archivos, la red ni el entorno.

El proyecto se organiza en tres niveles: el núcleo del lenguaje (`pl-lg`), un
servidor de lenguaje que solo analiza (`pl-lsp`) y una extensión de VS Code
(`pl-vscode`) que aporta el editor, el árbol de archivos, los diagnósticos y la
ejecución. La innovación principal es el modelo de capabilities con manifiesto
estático, atenuación por función y verificación en runtime.

Este documento consolida la documentación de los tres niveles, documenta el LSP
en detalle (sección 21), su ciclo de desarrollo y las decisiones tomadas
(sección 22), y presenta las pruebas exigidas por el entregable (sección 23).
La exclusión de importaciones está justificada en las secciones 15 y 23.5.

---

## 1. Introducción

Los lenguajes de shell son la herramienta natural para automatizar tareas: leer
configuración, consultar servicios, transformar datos y escribir resultados. Su
comodidad tiene un costo: un script se ejecuta con la autoridad ambiental del
usuario. Si el script lee `/etc/passwd`, escribe en el home o llama a cualquier
host, el sistema operativo no distingue si esa era la intención del programa.

Placitum explora una alternativa: un lenguaje pequeño, de sintaxis familiar, en
el que **todo efecto es visible en el código** y debe estar declarado antes de
ejecutarse. La declaración `needs` es la fuente de verdad; el analizador prueba
lo que puede probar y el runtime bloquea lo que no está concedido.

El documento cubre los requisitos del proyecto y deja explícito qué se
implementó y qué se excluyó con justificación. La sección 5 explica el alcance;
la 15, las importaciones; la 21, el LSP; la 22, el ciclo de desarrollo; y la 23,
la evidencia de pruebas.

---

## 2. Planteamiento del problema

### 2.1 Problema y motivación

Un script de shell típico se ejecuta con la misma autoridad que el usuario que
lo invoca. Puede leer cualquier archivo accesible, abrir conexiones de red, leer
variables de entorno y escribir donde tenga permiso. El código no declara esa
intención y el sistema operativo no la conoce: solo aplica permisos gruesos por
usuario, grupo o proceso.

Esto genera tres problemas:

1. **Efectos invisibles.** Al revisar un script no se sabe, a simple vista, qué
   recursos externos toca. Un `curl` escondido en una función o un `readFile`
   dentro de un pipe pasan desapercibidos.
2. **Autoridad excesiva.** Un script que solo necesita leer un JSON puede, en
   principio, escribir en todo el home o llamar a cualquier host.
3. **Dificultad para revisar código generado o copiado.** Scripts de internet,
   de un compañero o generados por un modelo de lenguaje se ejecutan con la
   misma confianza que un script propio.

La motivación de Placitum es hacer que la autoridad de un script sea
**explícita, enumerable y verificable** antes y durante la ejecución.

### 2.2 A quiénes afecta

- **Administradores de sistemas y DevOps:** ejecutan scripts de automatización
  con permisos elevados.
- **Desarrolladores:** comparten scripts de build, despliegue o migración.
- **Equipos de CI/CD:** ejecutan código de terceros en pipelines con secretos.
- **Agentes de IA y asistentes:** generan y ejecutan scripts que el usuario no
  escribió línea por línea.
- **Estudiantes:** aprenden shell scripting sin un modelo claro de permisos.

### 2.3 Contexto

El problema aparece en tareas cotidianas: leer configuración de servicios,
consultar una API de salud, transformar JSON, escribir reportes, limpiar
archivos temporales o automatizar una migración. En todos esos casos el script
necesita **alguna** autoridad, pero no toda la del usuario.

### 2.4 Soluciones existentes y sus limitaciones

| Solución | Qué aporta | Limitación para este problema |
|---|---|---|
| Permisos del sistema operativo (usuario/grupo) | Control de acceso grueso | No distingue la intención del script; un script del usuario hereda toda su autoridad. |
| Contenedores, VMs, sandboxes | Aíslan el proceso | Son externos al código, costosos de configurar y no declaran qué necesita el script. |
| `set -euo pipefail` y buenas prácticas de shell | Detectan errores y variables vacías | No limitan archivos, red ni entorno; no hay verificación de efectos. |
| Linters y revisión de código | Detectan patrones | No hay un modelo formal de autoridad; la revisión manual no escala. |
| Capabilities a nivel de sistema operativo (Capsicum, seccomp) | Aplican menor privilegio | Requieren integración de bajo nivel; no son portables a un script cualquiera. |
| Lenguajes con módulos de permisos (Deno, WASI) | Declaran permisos | El modelo y la ergonomía varían; no están pensados para scripts de shell. |

Ninguna de las soluciones relevadas ofrece, dentro del propio lenguaje, una
declaración de intención legible, una prueba estática de los usos literales y un
guard de runtime para los valores dinámicos.

### 2.5 Evidencias de investigación

La investigación fue **documental y técnica**. No se realizó un estudio con
usuarios; la evidencia principal es el análisis de la literatura, la comparación
de soluciones y el prototipo funcional con su suite de pruebas.

**Revisión documental.** Se estudiaron los principios de mínimo privilegio,
capabilities y object-capabilities, y su aplicación en sistemas UNIX
(Saltzer y Schroeder, 1975; Dennis y Van Horn, 1966; Miller, 2006; Watson et
al., 2012; NIST SP 800-53, AC-6).

**Análisis comparativo.** La tabla 2.4 contrasta permisos del sistema operativo,
sandboxes, buenas prácticas de shell, linters, capabilities del sistema y
lenguajes con permisos. El hallazgo es que ninguno combina, en el nivel del
lenguaje de scripting, declaración legible, prueba estática y guard de runtime.

**Prototipo funcional.** Se implementaron tres niveles: el núcleo del lenguaje,
el servidor LSP y la extensión de VS Code. El prototipo se valida con 199
pruebas del núcleo y 292 del servidor (sección 23), además de los guards y
smokes de la extensión.

**Observación de casos.** Se usaron scripts de auditoría de servicios, lectura
de configuración, transformación de JSON y escritura de reportes. En todos los
casos la autoridad necesaria es una fracción de la autoridad del usuario.

| Principio | Fuente | Decisión en Placitum |
|---|---|---|
| Mínimo privilegio | Saltzer y Schroeder (1975); NIST AC-6 | Cada script declara solo lo que necesita en `needs`. |
| Capabilities | Dennis y Van Horn (1966) | La autoridad se representa con tokens declarados, no con identidad global. |
| Object-capabilities | Miller (2006) | La autoridad se atenúa al pasarla a una función con `needs only(...)`. |
| Capabilities en UNIX | Capsicum, Watson et al. (2012) | El guard aplica la autoridad en runtime, además de la prueba estática. |
| Defensa en profundidad | Práctica de seguridad | Prueba estática para literales y guard para valores dinámicos. |
| Fallo cerrado | Práctica de seguridad | Sin grant, la operación se deniega con un error claro. |

### 2.6 Aporte de Placitum

Placitum introduce cuatro ideas articuladas:

1. **Declaración explícita.** `needs fs.read("data/*.json"), net("api.example.com")`
   enumera la autoridad del script.
2. **Efectos sintácticamente visibles.** Los builtins con efecto solo se
   alcanzan como *bang calls*: `fs.readFile!`, `fs.writeFile!`, `curl!`. No hay
   alias sin `!` ni forma de obtener una referencia de primera clase a un
   efecto.
3. **Doble verificación.** El extractor prueba estáticamente todo bang call con
   primer argumento literal (E301 si no está cubierto). El guard canonicaliza el
   valor real en runtime y aplica el grant (E401–E406).
4. **Manifiesto y atenuación.** `placitum explain` muestra lo probado y lo
   diferido; una función puede declarar `needs only(...)` para reducir su
   autoridad.

| Necesidad identificada | Característica de Placitum | Evidencia |
|---|---|---|
| Saber qué recursos toca un script | Cláusula `needs` | `pl-lg/README.md`, sección Capabilities |
| Ver los efectos en el código | Bang calls `nombre!(...)` | `pl-lg/README.md`, sección Pipes and builtins |
| Detectar usos no declarados antes de ejecutar | Prueba estática E301 | `pl-lg/tests/capability/negative/` |
| Bloquear valores dinámicos fuera del grant | Guard runtime E401–E406 | `pl-lg/tests/guard/` |
| Revisar la autoridad sin ejecutar | `placitum explain` | `pl-lg/tests/explain/` |
| Reducir permisos en funciones auxiliares | `needs only(...)` | `pl-lg/README.md`, atenuación |
| Tener retroalimentación en el editor | LSP y extensión VS Code | `pl-lsp/`, `pl-vscode/` |

---

## 3. Propuesta de solución

### 3.1 Usuarios

- Administradores y equipos de operaciones que escriben automatizaciones.
- Desarrolladores que comparten scripts de build, migración o reportes.
- Equipos de CI/CD que ejecutan código de terceros.
- Agentes de IA que generan scripts y necesitan un límite verificable.
- Estudiantes que aprenden un modelo explícito de permisos.

### 3.2 Contexto de uso

Placitum se usa desde la terminal (`placitum run archivo.placitum`) o desde VS
Code con la extensión. El caso típico es un script que lee un archivo de
configuración, consulta un servicio, transforma datos y escribe un reporte. La
extensión permite editar varios archivos en una carpeta, ver diagnósticos y
ejecutar el archivo activo.

### 3.3 Beneficios esperados

- Autoridad visible y revisable antes de ejecutar.
- Menor impacto de un script copiado o generado por IA.
- Errores con archivo, línea y sugerencia.
- Integración con el editor sin instalar el servidor globalmente.
- Modelo pequeño y enseñable.

### 3.4 Características principales

- `needs` y atenuación `only(...)`.
- Bang calls y builtins de efecto.
- Verificación estática + guard runtime.
- `placitum explain` y manifiesto.
- Tipos simples y compuestos, funciones de primera clase, closures.
- Pipes, condicionales, ciclos y operadores.
- Menú de referencia del lenguaje y estado de análisis en VS Code.
- CLI, LSP y extensión de VS Code.

### 3.5 Ejemplos de programas

**Hola mundo:**

```placitum
print!("hello, world")
```

**Lectura de configuración:**

```placitum
needs fs.read("**/config.json")

let config = fs.readFile!("config.json") | json.parse
print!(f"service={config.name}")
```

**Consulta HTTP con permiso de red:**

```placitum
needs net("api.example.com")

let response = "https://api.example.com/health" | curl!({ method: "GET" })
print!(f"status={response.status}")
```

Los ejemplos con rutas relativas deben ejecutarse desde el directorio del
proyecto; el guard canonicaliza la ruta y compara contra el grant.

### 3.6 Por qué un lenguaje nuevo

Agregar capabilities a bash requeriría cambiar su modelo de ejecución y su
sintaxis, y aun así quedarían formas de acceso ambiental. Un lenguaje pequeño
permite diseñar desde el inicio:

- una sintaxis que hace visibles los efectos (`!`),
- una declaración de autoridad (`needs`),
- un pipeline de análisis que puede probar los literales,
- un guard que controla los valores dinámicos,
- y un manifiesto que se puede mostrar al usuario.

---

## 4. Objetivos

### 4.1 Objetivo general

Diseñar e implementar un lenguaje de scripting con capabilities que haga
explícita, verificable y ejecutable la autoridad de un script, junto con las
herramientas de editor necesarias para usarlo.

### 4.2 Objetivos específicos

1. Definir la sintaxis y la semántica de un lenguaje de scripting con
   declaraciones `needs` y bang calls.
2. Implementar lexer, parser, extractor de capabilities, guard y evaluador.
3. Implementar la CLI `run` y `explain`.
4. Implementar un servidor LSP de solo análisis.
5. Integrar el servidor en una extensión de VS Code.
6. Verificar el funcionamiento con pruebas automatizadas.
7. Documentar el lenguaje, la arquitectura, las pruebas y las decisiones de
   alcance.

---

## 5. Alcance y limitaciones

### 5.1 Incluido

- Lenguaje de scripting de un solo archivo, con sintaxis, tipos, funciones,
  control de flujo, operadores, pipes y capabilities.
- Análisis estático y guard de runtime.
- CLI `placitum` con `run` y `explain`.
- Servidor LSP y extensión de VS Code.
- Pruebas automatizadas y documentación.

### 5.2 Excluido y justificado

| Exclusión | Justificación | Clasificación |
|---|---|---|
| Importaciones y archivo principal | Cada archivo es la unidad de ejecución y de seguridad; el workspace de VS Code cubre la organización multiarchivo. Autorizado por el docente. | Excluido autorizado |
| Entrada interactiva por stdin | Sería un canal ambiental implícito, contrario al modelo de capabilities. | Excluido autorizado |
| Separación entre enteros y flotantes | Un solo `number` (IEEE double) evita overflow, coerciones y dos conjuntos de operadores. | Excluido autorizado |
| Botón de compilación separado e IDE propio | El análisis es continuo vía LSP; VS Code es la IDE y el lenguaje es interpretado. | Excluido autorizado |
| Warnings | El esquema admite `warning`, pero no hay emisores; todos los diagnósticos actuales son errores. | Parcial |
| Errores de importación | No hay imports. | N/A |

La regla aplicada es: **excluido autorizado** significa que no se implementa
porque el modelo del lenguaje o la IDE lo hacen innecesario, con justificación
técnica; **parcial** significa que está implementado en parte; **N/A** significa
que el requisito no aplica porque la característica no existe.

### 5.3 Limitaciones

- Cada script es independiente; no hay imports ni reutilización de funciones
  entre archivos (exclusión autorizada).
- No hay entrada interactiva por stdin; la entrada es explícita vía
  `fs.readFile!`, `curl!` o la validación de `env(...)`.
- Un solo tipo numérico (`number`, IEEE double); no hay enteros separados.
- No hay clases, módulos, concurrencia, depurador ni gestor de paquetes.
- No hay indexación de arrays (`xs[0]` es error de parseo); se recorren con
  `for..in`.
- No hay `break`, `continue` ni operador ternario.
- El análisis estático no reemplaza al guard: los valores dinámicos se
  verifican en runtime.
- Un bang call literal anidado dentro de los argumentos de otro bang call se
  verifica solo en runtime (limitación conocida del extractor).
- El lenguaje es interpretado; no genera código objeto.
- No hay warnings: los diagnósticos actuales son errores.
- La extensión no se probó de forma interactiva dentro de VS Code; se usaron
  smokes, guards y lectura de código.

---

## 6. Descripción del lenguaje

### 6.1 Identidad

| Atributo | Valor |
|---|---|
| Nombre | Placitum |
| Propósito | Scripting con autoridad explícita y verificable |
| Usuarios | Operaciones, desarrollo, CI/CD, agentes de IA y estudiantes |
| Extensión de archivo | `.placitum` |
| Implementación | TypeScript sobre Node.js 20+ |
| Modelo | Interpretado, tipado dinámico, un archivo por programa |
| Identidad visual | Marca pixel-art con paleta cian, azul, blanco y tonos oscuros; versiones cuadrada, redondeada, circular, transparente y monocroma |

### 6.2 Filosofía de diseño

- **Un script, una autoridad.** El manifiesto pertenece a la invocación.
- **Efectos visibles.** Todo builtin con efecto se escribe con `!`.
- **Confianza mínima.** El evaluador y la stdlib no tienen I/O; solo
  `host-bindings` toca el sistema.
- **Defensa en profundidad.** La prueba estática y el guard runtime son
  complementarios.
- **Fallo cerrado.** Sin grant, la operación se deniega con un error claro.
- **Herramientas primero.** El lenguaje se usa desde un editor con
  diagnósticos, no solo desde la terminal.

### 6.3 Modelo de programa y autoridad

Un programa es un archivo `.placitum` con una secuencia de sentencias. La
autoridad se declara al inicio con `needs`; las funciones pueden atenuarla con
`needs only(...)`. Los efectos se escriben como bang calls y el analizador
produce un **manifiesto** con lo probado estáticamente y lo diferido a runtime.

### 6.4 Ecosistema

| Nivel | Componente | Función |
|---|---|---|
| Núcleo | `pl-lg` / paquete `placitum` | Lexer, parser, extractor, guard, evaluador, CLI `run`/`explain`, stdlib. |
| Servidor | `pl-lsp` / paquete `placitum-lsp` | Análisis estático y protocolo LSP; nunca ejecuta código. |
| Editor | `pl-vscode` / extensión `placitum-vscode` | Gramática, cliente LSP, diagnósticos, manifiesto y ejecución del archivo activo. |

---

## 7. Palabras reservadas

| Palabra | Propósito | Forma de uso | Ejemplo |
|---|---|---|---|
| `needs` | Declarar capabilities | Al inicio del script o después de los parámetros de una `fn` | `needs fs.read("data/*.json")` |
| `let` | Declarar una variable | `let nombre = expresion` | `let total = 0` |
| `fn` | Definir una función | `fn nombre(params) { ... }` | `fn add(a, b) { return a + b }` |
| `if` | Condicional | `if condicion { ... }` | `if total > 0 { print!("ok") }` |
| `else` | Alternativa | Después de `}` en la misma línea | `} else { print!("no") }` |
| `while` | Ciclo mientras | `while condicion { ... }` | `while retries > 0 { retries = retries - 1 }` |
| `for` | Ciclo sobre arrays | `for item in array { ... }` | `for item in items { print!(item) }` |
| `in` | Introduce el iterable | Parte de `for` | `for endpoint in config.endpoints` |
| `return` | Retornar o terminar | `return expresion` o `return` | `return total` |
| `not` | Negación lógica | `not expresion` | `if not ready { print!("wait") }` |
| `only` | Atenuar capabilities de una función | `needs only(capability)` | `fn f() needs only(fs.read("**/x")) { ... }` |
| `true` | Booleano verdadero | Literal | `let ok = true` |
| `false` | Booleano falso | Literal | `let ok = false` |
| `null` | Valor nulo | Literal | `let owner = null` |

`fs`, `net`, `exec`, `env`, `read` y `write` **no** son palabras reservadas:
se lexan como identificadores y se usan en las cláusulas `needs` y en las rutas
de miembros. `!` tampoco es una palabra reservada: es la marca sintáctica de un
bang call y debe ir pegada al target (`fs.readFile!(...)`, no
`fs.readFile !(...)`).

---

## 8. Sintaxis

### 8.1 Estructura del programa

- Una sentencia por línea; `;` no existe (E104).
- `#` inicia un comentario hasta el final de la línea.
- `#!strict` es un pragma opcional y solo puede estar en la línea física 1.
- Los bloques se delimitan con `{}`; la indentación no es obligatoria.
- `needs` va antes de la primera sentencia no-`needs` de nivel superior, o
  justo después de la lista de parámetros de una función.

```placitum
#!strict
# comentario

needs fs.read("**/config.json")

let x = 1
print!(x)
```

### 8.2 Declaración y asignación

```placitum
let name = "valor"   # declaración con inicializador obligatorio
name = "otro"        # asignación a un binding existente
```

No hay `+=`, `++` ni declaración sin inicializador. Una redeclaración en el
mismo scope es E506; un scope interno puede sombrear.

### 8.3 Entrada y salida

La salida se hace con `print!` y `eprint!`. La entrada es **explícita**: no hay
stdin interactivo; se lee con `fs.readFile!`, se consulta con `curl!` o se
valida una variable de entorno con `env(...)`.

```placitum
print!("resultado")
eprint!("diagnóstico")
```

### 8.4 Condicionales y ciclos

```placitum
if score >= 5 {
    print!("healthy")
} else if score > 0 {
    print!("degraded")
} else {
    print!("down")
}

while retries > 0 {
    retries = retries - 1
}

for endpoint in config.endpoints {
    print!(endpoint)
}
```

`else` debe seguir al `}` en la misma línea. Las condiciones usan la tabla de
verdad de la sección 9.3. `for..in` recorre únicamente arrays. No hay `break` ni
`continue`.

### 8.5 Funciones

```placitum
fn add(a, b) {
    return a + b
}

fn log(message) {
    print!(message)
    return
}

fn read_config(path) needs only(fs.read("**/config.json")) {
    return fs.readFile!(path) | json.parse
}
```

- Parámetros y argumentos posicionales; aridad exacta (E503).
- Sin defaults, variádicos ni sobrecarga.
- Sin hoisting: declarar antes de llamar; la recursión sí funciona.
- Funciones de primera clase: asignar, pasar, retornar, guardar en arrays u
  objetos, pipear.
- Closures: capturan y pueden mutar `let` externos.

### 8.6 Operadores y precedencia

| Precedencia (mayor → menor) | Operadores | Notas |
|---|---|---|
| postfix | `.member`, `call(...)`, `target!(...)` | miembros solo en objetos; bang calls siempre con `(...)` |
| unario | `not`, `-` | `not` produce booleano; `-` requiere número |
| multiplicativo | `*`, `/` | solo números; `/0` es E504 |
| aditivo | `+`, `-` | `+` es número+número o string+string; no mezcla |
| relacional | `<`, `<=`, `>`, `>=` | solo números |
| igualdad | `==`, `!=` | igualdad profunda en arrays/objetos |
| AND lógico | `&&` | cortocircuito |
| OR lógico | `\|\|` | cortocircuito |
| pipe | `\|` | pasa el valor a la siguiente etapa |
| asignación | `=` | target identificador; asociativa a la derecha |

No hay indexación (`xs[0]` es error), ni ternario, ni `+=`, ni `++`.

### 8.7 Pipes y bang calls

```placitum
let config = fs.readFile!("app.json") | json.parse
print!("mid" | wrap("[", "]"))
let response = "https://api.example.com/health" | curl!({ method: "GET" })
```

Un pipe evalúa la etapa izquierda y la pasa como primer argumento de la etapa
derecha. Los builtins con efecto solo se alcanzan con `!` pegado al target.

---

## 9. Semántica

### 9.1 Inicio y bloques

Un programa comienza en la primera sentencia de nivel superior. Un `return` de
nivel superior termina el script con éxito. Los bloques `{}` delimitan scopes;
la indentación no cambia la semántica.

### 9.2 Variables y alcances

- `let` declara un binding en el scope actual.
- La asignación escribe el binding más cercano que exista; si no existe, E500.
- Cada bloque (`if`, `while`, `for`, función) es un scope.
- Los scopes internos pueden sombrear; el mismo scope no puede redeclarar
  (E506).
- Las funciones son closures: capturan el entorno y pueden mutar `let`
  externos.
- `let x = x` evalúa el inicializador antes de definir `x`: lee un `x` externo
  o produce E500.
- Las closures resuelven nombres en tiempo de llamada; por eso un uso dentro de
  una función puede referirse a un `let` posterior si ya existe al invocarla.

### 9.3 Expresiones y verdad

Las expresiones se evalúan de izquierda a derecha con la precedencia de la
sección 8.6. `&&` y `||` cortocircuitan. La verdad sigue esta tabla:

| Valor | Truthy |
|---|---|
| `false`, `null`, `0`, `""` | No |
| `true`, números distintos de 0, strings no vacíos | Sí |
| arrays y objetos (incluidos vacíos) | Sí |
| funciones | Sí |

### 9.4 Condiciones y ciclos

`if` y `while` usan la verdad del valor; no imponen un tipo booleano. `for..in`
solo acepta arrays (E501 si no). El iterador vive solo dentro del cuerpo.

### 9.5 Llamadas y retorno

Una llamada evalúa el callee y los argumentos, verifica la aridad y ejecuta el
cuerpo en un nuevo scope. `return` devuelve un valor; sin argumento devuelve
`null`. Un `return` de nivel superior termina el script. Llamar un valor no
invocable es E502.

### 9.6 Errores

Cada fallo produce un sobre con código, fase, severidad, mensaje, ubicación y
sugerencia. La CLI sale con código 1; la ejecución sin error sale con 0. Los
errores de sintaxis impiden ejecutar; los errores de evaluación ocurren cuando
se alcanza la instrucción (sección 17.4).

---

## 10. Tipos de datos

### 10.1 Tipos simples

| Tipo | Declaración / uso | Operaciones permitidas | Restricciones |
|---|---|---|---|
| `string` | `"texto"`, `f"hola {name}"` | `+` con string, `==`, `!=`, print, pipes | Una línea; escapes `\n \t \r \\ \"`; sin `.length` ni métodos |
| `number` | `42`, `3.14`, resultados aritméticos | `+ - * /`, comparaciones, igualdad | IEEE double; no hay enteros separados; `/0` es E504; sin hex/exponente |
| `boolean` | `true`, `false` | `&&`, `\|\|`, `not`, igualdad | Solo dos valores |
| `null` | `null` | Igualdad, print | Falsy; no tiene operaciones propias |

En el texto de una f-string se admiten además los escapes `\{` y `\}`. Los
strings son de una sola línea y no tienen `.length` ni métodos.

### 10.2 Tipos compuestos

| Tipo | Declaración / uso | Operaciones permitidas | Restricciones |
|---|---|---|---|
| `array` | `[1, "dos"]`, `json.parse` | `for..in`, igualdad profunda, print/JSON | Sin indexación; solo arrays son iterables |
| `object` | `{ name: "app", enabled: true }` | `.member`, igualdad profunda, print/JSON | Claves identificador sin comillas; no es iterable; miembro faltante lee `null` |
| `function` | `fn`, `json.parse` | Llamar, pipear, pasar, retornar, guardar | Igualdad por identidad; imprimir muestra `[closure name]`/`[native name]` |

Los dos tipos compuestos exigidos por el enunciado son `array` y `object`; la
función es un tipo de primera clase adicional.

La igualdad es profunda para arrays/objetos y por identidad para funciones;
los tipos no se declaran, se infieren en runtime (y el LSP los infiere
estáticamente cuando puede). La decisión de un solo tipo numérico se justifica
en la sección 5.2.

---

## 11. Funciones

Las funciones son el mecanismo de reutilización dentro de un archivo. Se
declaran con `fn`, reciben parámetros posicionales y retornan con `return`.

```placitum
fn classify(score) {
    if score >= 90 {
        return "A"
    } else if score >= 70 {
        return "B"
    } else {
        return "C"
    }
}

let grade = classify(85)
print!(grade)
```

Características:

- Retorno explícito o `null` si no hay `return`.
- Aridad exacta; no hay sobrecarga ni valores por defecto.
- Sin hoisting: la función debe existir antes de la llamada.
- Recursión permitida.
- Funciones de primera clase, closures y pipes.
- Atenuación de capabilities con `needs only(...)`.

```placitum
needs fs.read("**/config.json"), fs.write("**/log.txt")

fn read_config(path) needs only(fs.read("**/config.json")) {
    return fs.readFile!(path) | json.parse
}
```

La función `read_config` solo puede leer; no hereda el grant de escritura. Si su
cláusula pidiera más autoridad que la del scope padre, sería E303.

---

## 12. Estructuras de control

| Estructura | Sintaxis | Uso |
|---|---|---|
| Condicional simple | `if cond { ... }` | Ejecuta un bloque si la condición es truthy |
| Condicional con alternativa | `if cond { ... } else { ... }` | Dos ramas |
| Condicional múltiple | `if cond1 { ... } else if cond2 { ... } else { ... }` | Cadena de alternativas |
| Ciclo mientras | `while cond { ... }` | Repite mientras la condición sea truthy |
| Ciclo sobre array | `for item in array { ... }` | Itera elementos de un array |

No hay `break`, `continue`, `switch` ni `do..while`. La combinación de `if`,
`while`, `for` y funciones cubre los casos del proyecto.

---

## 13. Operaciones

### 13.1 Aritméticas

`+`, `-`, `*`, `/` sobre números. `+` también concatena strings del mismo tipo.
La división por cero es E504.

### 13.2 Lógicas

`&&`, `||`, `not`. `&&` y `||` cortocircuitan y devuelven un booleano según la
tabla de verdad.

### 13.3 Relacionales

`==`, `!=`, `<`, `<=`, `>`, `>=`. Las comparaciones de orden son solo para
números; la igualdad es profunda para arrays/objetos y por identidad para
funciones.

### 13.4 Pipes

`|` encadena etapas. Cada etapa recibe el valor anterior como primer argumento:

| Etapa | Llamada equivalente |
|---|---|
| `name` / `obj.name` | `callee(valor)` |
| `f(extra, args)` | `f(valor, extra, args)` |
| `target!(extra, args)` | `target!(valor, extra, args)` |

---

## 14. Organización de archivos

### 14.1 Repositorios

```text
pl-lg/        núcleo: lexer, parser, extractor, guard, evaluador, CLI
pl-lsp/       servidor LSP: análisis, features, protocolo, pruebas
pl-vscode/    extensión VS Code: gramática, cliente LSP, comandos
```

### 14.2 Workspace de VS Code

El proyecto se organiza como una carpeta de VS Code. El explorador permite:

- crear una carpeta/proyecto y archivos `.placitum`,
- abrir archivos,
- renombrar,
- eliminar,
- seleccionar el archivo activo.

La extensión registra el lenguaje `.placitum`, aporta gramática, diagnósticos
y comandos. El árbol de archivos es el de VS Code; no se implementa un árbol
propio.

### 14.3 Archivo activo como punto de entrada

Cada archivo `.placitum` es ejecutable por sí mismo. El “punto de entrada” es
el archivo activo: `Placitum: Run file` guarda ese archivo y lo ejecuta con el
CLI bundleado. No hay un archivo `main` ni una validación de proyecto completo.

Esta decisión es coherente con un lenguaje de shell: cada script es una unidad
de ejecución. La exclusión del archivo principal se justifica en la sección 15.

---

## 15. Importaciones

### 15.1 Decisión

El lenguaje **no incluye** `import` ni módulos. Cada archivo `.placitum` es una
unidad independiente. La organización de varios archivos se hace con el
workspace de VS Code.

### 15.2 Justificación

- Placitum es un lenguaje de shell. La unidad de ejecución y de seguridad es el
  archivo `.placitum`: cada script declara su propio `needs` y se ejecuta de
  forma independiente.
- Componer manifiestos de capabilities entre archivos introduciría ambigüedad
  sobre qué permisos hereda cada función y rompería el modelo “un script = un
  límite de capabilities”.
- VS Code cubre la organización multiarchivo: abrir carpeta, crear, abrir,
  renombrar, eliminar y seleccionar archivos.
- El archivo activo es el punto de entrada; `Placitum: Run file` lo guarda y lo
  ejecuta.

Esta exclusión fue **autorizada por el docente**. No es una equivalencia
funcional con imports: no hay reutilización de funciones entre archivos. Las
funciones compartidas deben duplicarse o extraerse a un script invocable.

### 15.3 Texto para el docente

> Placitum es un lenguaje de shell orientado a scripts con capabilities. La
> unidad de ejecución y de seguridad es el archivo `.placitum`: cada script
> declara su propio `needs` y se ejecuta de forma independiente. Componer
> manifiestos de capabilities entre archivos introduciría ambigüedad sobre qué
> permisos hereda cada función y rompería el modelo de “un script = un límite
> de capabilities”. Por eso se excluyó un sistema de importaciones. El proyecto
> se organiza como un workspace de VS Code: el explorador permite crear, abrir,
> renombrar, eliminar y seleccionar archivos, y el archivo activo es el punto
> de entrada que ejecuta `Placitum: Run file`. Esta exclusión fue autorizada
> por el docente. Limitación: no hay reutilización de funciones entre archivos.

### 15.4 Evidencia de ausencia

`import` no es una palabra reservada ni una declaración del lenguaje. Una línea
como `import "otro.placitum"` no se reconoce como importación: el parser la
rechaza con E201. No existe semántica de imports que probar; las pruebas de
importación se documentan como N/A en la sección 23.5.

---

## 16. Proceso de compilación y análisis

### 16.1 Qué significa compilar

En Placitum, “compilar” significa **analizar estáticamente** el fuente. No se
genera código objeto: el lenguaje es interpretado. El análisis se ejecuta en la
CLI antes de correr y de forma continua en el LSP.

### 16.2 Pipeline

```text
fuente → lexer → parser → extractor → guard (runtime) → evaluador
          E1xx     E2xx       E3xx          E4xx             E5xx
```

| Etapa | Archivo | Entrada → salida | Errores |
|---|---|---|---|
| Lexer | `pl-lg/src/lexer/lexer.ts` | texto → tokens + comentarios | E101–E106 |
| Parser | `pl-lg/src/parser/parser.ts` | tokens → AST | E201–E206 |
| Extractor | `pl-lg/src/capability/extractor.ts` | AST → manifiesto + prueba estática | E301–E305 |
| Guard | `pl-lg/src/capability/guard.ts` | autorización runtime | E401–E406 |
| Evaluador | `pl-lg/src/evaluator/` | AST + guard → ejecución | E500–E506 |
| CLI | `pl-lg/src/cli/` | `run`, `explain`, flags | E601–E603 |

### 16.3 Chequeos estáticos

- Lexer y parser tolerantes para reportar varios errores y recuperar el AST.
- Extractor: todo bang call con primer argumento literal debe estar cubierto
  por un grant (E301).
- Guard: canonicaliza rutas y compara contra el grant; cubre valores
  dinámicos.
- LSP: binder E500/E506, strict E505, chequeos literales E501–E504.
- Cascada controlada: un error léxico salta el parseo; un error de parseo salta
  la extracción; un AST recuperado no genera chequeos semánticos en cascada.

### 16.4 Diagnósticos y estado

El LSP publica diagnósticos con rango UTF-16, código, mensaje y sugerencia. En
VS Code se ven en el panel Problems y en el editor. `Placitum: Reanalyze file`
fuerza el análisis.

No hay un botón “Compilar” separado porque el análisis es continuo y el
lenguaje es interpretado. El estado resumido se muestra en la barra de estado
(`OK`, errores o advertencias del archivo activo) y en el canal de salida
**Placitum — Analysis**; `Placitum: Show analysis status` lo abre.

---

## 17. Proceso de ejecución

### 17.1 Pipeline de ejecución

1. Leer el archivo (E601 si no se puede).
2. Lexer y parser (E1xx/E2xx).
3. Extraer el manifiesto y probar los literales (E3xx).
4. Crear el guard y verificar `env` requeridas (E406).
5. Evaluar el AST con la stdlib inyectada.
6. Escribir resultados con `print!`/`eprint!`; salir 0 o 1.

```bash
placitum run script.placitum
placitum explain script.placitum
```

### 17.2 Guard de capabilities

- Canonicaliza rutas (`..`, symlinks) antes de comparar.
- `fs.read`/`fs.write` usan globs; `net` usa host exacto o `*.dominio`.
- `env(NAME)` exige la variable al inicio; `env(NAME?)` es opcional.
- `exec` está reservado y se aplica en runtime, pero ningún builtin lo consume.
- Una ruta que hacía match textual pero canonicaliza fuera del grant es E403.

### 17.3 Builtins

| Builtin | Firma | Grant | Notas |
|---|---|---|---|
| `print!(value)` | `(any) -> null` | ninguno | Salida estándar |
| `eprint!(value)` | `(any) -> null` | ninguno | Salida de error |
| `json.parse(text)` | `(string) -> any` | ninguno | Puro; JSON inválido E501 |
| `fs.readFile!(path)` | `(string) -> string` | `fs.read(...)` | Lee un archivo |
| `fs.writeFile!(path, contents)` | `(string, string) -> null` | `fs.write(...)` | Escribe un archivo |
| `curl!(url[, opts])` | `(string[, object]) -> object` | `net(...)` | HTTP; rechaza redirects |

### 17.4 Errores de ejecución

Un error de sintaxis impide ejecutar. Un error semántico de evaluación se
detecta cuando se alcanza la instrucción; las instrucciones anteriores pueden
haber producido efectos. Ejemplo verificado:

```placitum
print!("before")
let x = 1 + "a"
```

Salida: `before` y luego `E501_EVAL_TYPE_MISMATCH` (exit 1). Si se quiere
cumplir literalmente “no ejecutar con errores semánticos”, la extensión/CLI
debería hacer un pre-chequeo estático antes de lanzar el proceso. Es una mejora
pendiente; el lenguaje es dinámico y el guard no reemplaza un type-checker
completo.

**Limitación del extractor:** un bang call literal anidado dentro de los
argumentos de otro bang call (por ejemplo
`print!(fs.readFile!("/etc/hosts"))`) no se prueba estáticamente; se verifica
solo en runtime.

---

## 18. Manejo de errores

### 18.1 Taxonomía

| Fase | Códigos |
|---|---|
| Lex | E101–E106 |
| Parse | E201–E206 |
| Extract | E301–E305 |
| Guard | E401–E406 |
| Eval | E500–E506 |
| CLI | E601–E603 |

### 18.2 Sobre de error

```text
error[E402_GUARD_FS_READ_DENIED]: "/private/etc/hosts" (fsRead, canonicalized from "/etc/hosts") matches no granted capability
 --> script.placitum:3:8
  |
3 | print!(fs.readFile!("/etc/hosts"))
  |        ^^^^^^^^^^^^^^^^^^^^^^^^^^
  |
  = hint: Request the exact path/glob in a needs declaration.
```

El sobre incluye:

- tipo/código de error,
- archivo,
- línea y columna,
- descripción,
- sugerencia (`hint`),
- extracto de la línea y caret.

### 18.3 Errores y advertencias

- Todos los diagnósticos actuales son errores; el esquema admite `warning`,
  pero no hay emisores.
- No hay errores de importación porque no hay imports.
- Los resultados y el estado de ejecución se ven en la terminal; los
  diagnósticos, en VS Code.
- En el LSP, los errores de runtime (E4xx) no se reportan como diagnósticos:
  no son demostrables estáticamente. Se explican en hover, code lens y el
  manifiesto.

---

## 19. Innovación

### 19.1 Idea

La innovación es el **modelo de capabilities del lenguaje**: la autoridad de un
script es un dato explícito, no una consecuencia implícita de ejecutarse como
el usuario. Se combina prueba estática, guard runtime, manifiesto y atenuación.

### 19.2 Implementación

| Componente | Función |
|---|---|
| `needs` | Declara los grants del script |
| Bang calls | Hacen visible todo efecto |
| Extractor | Prueba literales contra el manifiesto |
| Guard | Canonicaliza y autoriza valores dinámicos |
| `explain` | Muestra el manifiesto sin ejecutar |
| `needs only(...)` | Reduce la autoridad de una función |
| LSP/extensión | Diagnósticos, hover, quick fixes, manifiesto |

### 19.3 Validaciones

- Prueba estática de literales (E301).
- Guard de rutas canónicas, globs y hosts.
- Rechazo de symlinks de escritura y redirects HTTP.
- Pruebas de capability, guard y chokepoint.
- Pruebas de LSP para diagnósticos, quick fixes y manifiesto.

### 19.4 Demostración

Para la defensa:

1. Ejecutar `placitum explain examples/rosetta.placitum` y mostrar el manifiesto.
2. Quitar un grant y mostrar E301 antes de ejecutar.
3. Cambiar una ruta por una fuera del grant y mostrar E402/E403 en runtime.
4. Abrir el archivo en VS Code, mostrar diagnósticos y el quick fix “Add needs”.
5. Mostrar `needs only(...)` en una función y explicar la atenuación.

---

## 20. Arquitectura del aplicativo

### 20.1 Componentes

```text
┌────────────────────────────────────────────────────────────┐
│ pl-lg — núcleo del lenguaje                                │
│ lexer → parser → extractor → guard → evaluador → CLI       │
│ única superficie con I/O: host-bindings                    │
└────────────────────────────────────────────────────────────┘
          ▲                                  ▲
          │ analyzeSource()                  │ placitum run/explain
          │                                  │
┌─────────┴──────────────────┐     ┌─────────┴──────────────┐
│ pl-lsp — solo análisis     │     │ usuario / terminal     │
│ JSON-RPC stdio             │     └────────────────────────┘
│ documents + analysis +     │
│ features                   │
└─────────▲──────────────────┘
          │ JSON-RPC stdio
┌─────────┴──────────────────┐
│ pl-vscode — extensión      │
│ gramática + LSP + comandos │
└────────────────────────────┘
```

### 20.2 Núcleo

El núcleo implementa el pipeline puro y la ejecución. Solo
`pl-lg/src/host-bindings` importa `fs`, `child_process`, red y OS. El evaluador
y la stdlib no tienen I/O. El extractor produce el manifiesto; el guard lo
aplica en runtime.

### 20.3 Servidor LSP

El servidor reutiliza el núcleo **sin ejecutarlo**. Se documenta en detalle en
la sección 21. Sus límites son: solo stdio, solo análisis, una versión de
análisis por documento y ninguna escritura directa a archivos del usuario.

### 20.4 Extensión de VS Code

La extensión es un cliente delgado:

- registra el lenguaje `.placitum`, la gramática y la configuración;
- arranca el servidor bundleado y muestra diagnósticos, completion, hover,
  rename, code lens, inlay hints y manifiesto;
- ejecuta el archivo activo con el CLI bundleado;
- no reimplementa análisis: aplica `WorkspaceEdit` y muestra resultados.

### 20.5 Flujo end-to-end

1. El usuario edita un `.placitum` en VS Code.
2. La extensión envía `didChange` al LSP.
3. El LSP analiza con el barril del núcleo.
4. Los diagnósticos vuelven al editor.
5. `Placitum: Run file` guarda y ejecuta el CLI bundleado.
6. El CLI lexa, parsea, extrae, crea el guard y evalúa.

### 20.6 Límites de seguridad

- Solo `pl-lg/src/host-bindings` importa `fs`, `child_process`, red y OS.
- El evaluador y la stdlib no tienen I/O.
- `pl-lsp` nunca ejecuta código Placitum.
- La extensión no reimplementa análisis: solo muestra resultados y aplica
  `WorkspaceEdit`.
- El servidor y el CLI viajan bundleados en la extensión; no se requiere una
  instalación global.

### 20.7 Versiones

| Componente | Paquete | Versión de entrega | Estado de publicación |
|---|---|---|---|
| Núcleo | `placitum` | 1.0.1 | Publicado en npm |
| Servidor | `placitum-lsp` | 0.1.1 | 0.1.0 publicado en npm; 0.1.1 preparado |
| Extensión | `placitum-vscode` | 0.1.3 | `.vsix` / Marketplace; no se publica en npm |

El núcleo `1.0.1` está publicado en npm; el servidor `0.1.1` está preparado
en su repo, pero npm todavía tiene `0.1.0`. La extensión `0.1.3` empaqueta las
versiones publicadas hasta que se publique la nueva. Los tags finales son
`v1.0.1`, `v0.1.1` y `v0.1.3`.

---

## 21. Servidor de lenguaje (LSP)

### 21.1 Qué es y por qué existe

El **Language Server Protocol (LSP)** es un protocolo estándar entre un editor
(cliente) y un servidor de lenguaje. El cliente envía eventos y pedidos
(`textDocument/didChange`, `textDocument/hover`, …) por JSON-RPC; el servidor
responde con resultados y notificaciones (`textDocument/publishDiagnostics`).
El transporte es **stdio**: cada mensaje va precedido por
`Content-Length: N\r\n\r\n`. Por eso **stdout es sagrado**: un `console.log`
rompe el protocolo.

`placitum-lsp` es un servidor de **solo análisis**: reutiliza el lexer, parser,
extractor y renderer del núcleo, pero nunca importa el evaluador, el guard, el
runtime de la stdlib ni `host-bindings`. Sí usa las tablas puras de firmas y
categorías. Un archivo malicioso solo puede producir diagnósticos.

**Contrato mínimo.** Un cliente que implemente `initialize`,
`textDocument/didOpen|didChange|didClose` y reciba
`textDocument/publishDiagnostics` ya obtiene valor. Todo lo demás es opcional y
se degrada si el cliente no lo declara.

### 21.2 Arquitectura interna

| Archivo | Responsabilidad |
|---|---|
| `src/bin.ts` | Entrada CLI: flags, `--version`, `--help`, transporte stdio; rechaza `--node-ipc`/`--socket` con exit 2. |
| `src/server.ts` | Ciclo de vida, capabilities, registro de handlers, comandos, watchers y carpetas. |
| `src/documents.ts` | Mapa de `TextDocument`, caché de análisis por versión, debounce de 80 ms, publicación push/pull. |
| `src/config.ts` | Settings con parseo defensivo; tipos incorrectos vuelven al default. |
| `src/log.ts` | Logs a stderr o archivo; nunca stdout. |
| `src/workspace/files.ts` | Único lector de archivos del workspace: escaneo de `.placitum` para workspace symbols, con cap y caché por mtime. |
| `src/analysis/core-adapter.ts` | Única frontera con `placitum`; congela la API del núcleo. |
| `src/analysis/positions.ts` | Conversión span/line/col ↔ `Position`/`Range` UTF-16, con clamping. |
| `src/analysis/binder.ts` | Scopes, bindings, occurrences y diagnósticos E500/E506. |
| `src/analysis/types.ts` | `TypeInfo` e inferencia best-effort. |
| `src/analysis/checks.ts` | Chequeos estáticos “definitely-certain” E501–E504. |
| `src/analysis/capabilities.ts` | Manifest efectivo por scope, cobertura de bangs y chequeos diferidos. |
| `src/analysis/model.ts` | Objeto `Analysis` con todo lo derivado de una versión del documento. |
| `src/features/*` | Funciones puras `(Analysis, Position) → resultado LSP`. |

La regla de dependencias es estricta: solo el adapter importa el núcleo; solo
`workspace/files.ts` y `log.ts` importan `fs`; el código de features no importa
`child_process`, red ni OS. `scripts/check-deps.mjs` valida la allow-list y
ESLint aplica las fronteras de import.

### 21.3 Pipeline de análisis

```text
didOpen / didChange / didClose
        │
        ▼
documents.ts: TextDocument (sync incremental) + versión
        │
        ▼
createAnalysis()
        ├── core-adapter.analyze(source)  → lex / parse / extract
        ├── binder                        → scopes, occurrences, E500/E506
        ├── types + checks                → E501–E504
        ├── strict                        → E505 (solo con #!strict)
        └── capabilities                  → grants efectivos, diferidos
        │
        ▼
Analysis { uri, version, document, core, binder, comments,
           staticChecks, strictChecks, capabilities }
        │
        ▼
features/*  (diagnósticos, completion, hover, rename, …)
```

Decisiones del pipeline:

- **Un análisis por versión.** Se cachea el `Analysis` de la versión actual; un
  request usa `freshAnalysis()` para recalcular si la versión cambió y no
  esperar al debounce.
- **Debounce de 80 ms** para publicar diagnósticos mientras se tipea. No hay
  worker threads: el análisis típico es de pocos milisegundos.
- **AST recuperado.** Si hubo errores de parse, el AST puede existir pero está
  incompleto: no se ejecutan chequeos semánticos ni de capabilities para evitar
  cascadas.
- **Posiciones UTF-16.** El núcleo reporta `line`/`col` 1-based y `span` como
  offsets UTF-16; el servidor declara `positionEncoding: utf-16` y centraliza
  la conversión en `positions.ts`, con clamping para EOF, spans invertidos,
  CRLF y emojis.
- **Errores contenidos.** Cada handler captura excepciones, las registra y
  devuelve un resultado seguro o un `ResponseError`; un archivo malo nunca
  tumba el servidor.

### 21.4 Funcionalidades

| Funcionalidad | Método LSP | Comportamiento |
|---|---|---|
| Diagnósticos | `textDocument/publishDiagnostics` y `textDocument/diagnostic` | Errores del núcleo E1xx–E3xx, binder E500/E506, strict E505 y literales E501–E504, con rangos exactos. Push para todos; pull solo si el cliente lo declara. |
| Completion | `textDocument/completion` | Por contexto: pragma, `needs`, `fs.`, `only(`, `env(`, miembro, etapa de pipe y posición general. |
| Hover | `textDocument/hover` | Bindings, builtins, miembros, bang calls (cubierto/diferido/ambient), tokens de capability, keywords y pragma. |
| Signature help | `textDocument/signatureHelp` | Paréntesis activo, parámetro activo y `piped` antepuesto en stages de pipe. |
| Definición | `textDocument/definition`, `textDocument/typeDefinition` | `LocationLink` si el cliente lo soporta; `Location[]` si no. |
| Referencias | `textDocument/references` | Ocurrencias del binding en el archivo; single-file. |
| Rename | `textDocument/rename`, `prepareRename` | Scope-aware, con validación de nombre, keywords y colisiones. |
| Símbolos | `textDocument/documentSymbol`, `workspace/symbol` | Árbol o lista plana; workspace symbols on demand con cap y caché. |
| Semantic tokens | `textDocument/semanticTokens/full` y `full/delta` | Clasificación AST-first, deltas por versión. |
| Folding | `textDocument/foldingRange` | Bloques, literales multilínea, comentarios y grupos de `needs`; fallback de llaves. |
| Selection ranges | `textDocument/selectionRange` | Cadena de ancestros del AST; fallback token → línea → documento. |
| Highlights | `textDocument/documentHighlight` | Lecturas y escrituras del binding bajo el cursor. |
| Code actions | `textDocument/codeAction` | Quick fixes deterministas: `add needs`, insertar `}`, declarar con `let`, renombrar redeclaraciones. |
| Code lens | `textDocument/codeLens` | Conteo de grants/diferidos sobre `needs`; resumen de `needs only(...)` en funciones. |
| Inlay hints | `textDocument/inlayHint` | Tipos inferidos de `let` (off por defecto) y cobertura de bangs (opt-in). |
| Manifiesto | `placitum/manifest` | `{ markdown, manifest, diagnostics }`; el markdown es el `explain` del núcleo byte a byte. |
| Comandos | `workspace/executeCommand` | `placitum.showManifest`, `placitum.reanalyze`, `placitum.addNeeds`. |

### 21.5 Diagnósticos y posiciones

El servidor combina cuatro fuentes:

| Fuente | Códigos | Cuándo |
|---|---|---|
| Núcleo | E1xx, E2xx, E3xx | Siempre que el análisis del núcleo los produzca. |
| Binder | E500, E506 | Nombre no resoluble o redeclaración en el mismo scope. |
| Strict | E505 | Solo con `#!strict`, sobre cadenas de pipes. |
| Chequeos literales | E501–E504 | Solo cuando el error es seguro en todo camino: literales incompatibles, callee no invocable, aridad conocida, división por cero literal. |

Los errores de runtime (E4xx y los E5xx que no sean demostrables) **no** se
publican como diagnósticos. Se explican en hover, code lens y el manifiesto.

Mapeo de cada error a `Diagnostic`:

- `range`: del `span` UTF-16, con clamping.
- `severity`: Error para todos los códigos actuales.
- `code`: el código completo, por ejemplo
  `E301_EXTRACT_UNCOVERED_CAPABILITY`.
- `source`: `"placitum"`.
- `message`: el mensaje del núcleo, con `hint` adjunto si existe.
- `data`: `{ phase, hint, quickFixes }`, opaco para el cliente.
- `relatedInformation`: la declaración anterior en E506.

**Push y pull.** Los clientes que declaran `textDocument.diagnostic` reciben
`diagnosticProvider` y usan pull; el servidor suprime el push para evitar
duplicados (VS Code une ambas colecciones). El resto sigue con push.

### 21.6 Capability UX y manifiesto

- **Code lens.** Sobre cada `NeedsDecl` de nivel superior muestra
  `N grant(s) · M deferred — show manifest`; sobre cada `fn` con `needs`,
  `needs only(...)` truncado. Los conteos salen del manifiesto del extractor.
- **Quick fix “Add needs”.** Localiza el `BangCall` por span, calcula el token
  como lo haría el extractor (`net` con el hostname del `URL` en minúsculas;
  `fs.read`/`fs.write`/`exec` con el literal escapado) y lo agrega al `needs`
  del scope más cercano, o inserta una línea nueva después del pragma. Si el
  token ya existe, no ofrece nada.
- **Manifiesto.** `placitum/manifest` devuelve el markdown de `explain()` del
  núcleo, sin re-renderizar. Si el archivo no parsea, lista los diagnósticos y
  pide corregir la causa.
- **Comandos.** `placitum.showManifest` muestra el manifiesto por
  `window/showMessage` con cap de 10 KB (el texto completo va al log);
  `placitum.reanalyze` reanaliza y republica; `placitum.addNeeds` aplica la
  primera corrección E301 vía `workspace/applyEdit`.
- **Inlay hints.** Desactivados por defecto. Si se activan, muestran
  `: <tipo>` después de un `let` con tipo inferido y, opcionalmente,
  `«needs …»` después de un bang cubierto estáticamente.
- **E303.** El quick fix “reemplazar por el grant que cubre” se omitió por
  inaplicable: el extractor aborta en E303 y la atenuación garantiza que el
  scope padre no cubra al hijo. Era un ítem opcional de la directiva.
- **`placitum.explainDeferred`.** No se implementó: el hover del bang ya explica
  el motivo del deferral.

### 21.7 Configuración

Los settings se sirven bajo la sección `placitum` vía
`workspace/configuration`; `initializationOptions.placitum` los sobrescribe al
inicio. Tipos incorrectos y claves desconocidas vuelven al default.

| Clave | Default | Efecto |
|---|---|---|
| `placitum.diagnostics.enable` | `true` | Activa diagnósticos. |
| `placitum.diagnostics.scope` | `true` | E500/E506 del binder. |
| `placitum.diagnostics.strictChecks` | `true` | E505 con `#!strict`. |
| `placitum.diagnostics.literalTypes` | `true` | E501–E504 seguros. |
| `placitum.completion.enable` | `true` | Completion. |
| `placitum.completion.snippets` | `true` | Snippets en completion. |
| `placitum.codeLens.enable` | `true` | Code lens de `needs`. |
| `placitum.inlayHints.enable` | `false` | Inlay hints de tipos. |
| `placitum.inlayHints.capabilities` | `false` | Inlay hints de cobertura. |
| `placitum.workspaceSymbols.enable` | `true` | Búsqueda de símbolos del workspace. |
| `placitum.workspaceSymbols.maxFiles` | `2000` | Cap de archivos escaneados. |
| `placitum.trace.server` | `off` | Nivel de traza. |

Un cambio de configuración reanaliza los documentos abiertos y republica; a los
clientes pull se les pide refrescar.

### 21.8 Compatibilidad con editores

El servidor se degrada por capability. La matriz completa está en
`docs/COMPATIBILITY.md`; el resumen es:

| Sin esta capability | Comportamiento |
|---|---|
| `linkSupport` | `Location[]` en lugar de `LocationLink[]`. |
| `hierarchicalDocumentSymbolSupport` | `SymbolInformation[]` plana con `containerName`. |
| `contentFormat: markdown` | Hover en texto plano. |
| `snippetSupport` | Sin snippets; solo texto. |
| `workspace.configuration` | `initializationOptions` o defaults; no se pide configuración. |
| `dynamicRegistration` | No se registra el watcher de archivos. |
| `rootUri`/`workspaceFolders` | `workspace/symbol` devuelve `[]`. |
| `textDocument.diagnostic` | Sin pull; push cubre al cliente. |
| `semanticTokens` | El cliente conserva su resaltado propio. |

| Editor | Estado | Evidencia |
|---|---|---|
| Neovim 0.12 | Verificado y automatizado | E2E con la receta publicada: rename, completion, hover, E301 y manifiesto. |
| Neovim 0.10 + lspconfig | Verificado | Adjunta y recibe E500. |
| Helix 25.07 | Verificado | E301, hover, completion, rename y manifiesto. Necesita tree-sitter para resaltado. |
| Emacs 31 (eglot) | Verificado | E500, hover plaintext, completion y rename. |
| Emacs 31 (lsp-mode) | Verificado | Conexión, 19 capabilities y hover markdown. |
| Vim + vim-lsp 0.1.4 | Verificado | Servidor `running` y E500. |
| VS Code | Cubierto por la extensión | Diagnósticos, completion, hover, rename, manifiesto y ejecución, según sus guards y smokes. |
| Zed, Kate, Sublime, coc.nvim | Pendiente | Sin superficie headless o paquete disponible; no se reportan como verificados. |

La verificación manual se registra con fecha y versión en
`docs/EDITOR-CHECKLIST.md`.

### 21.9 CLI, empaquetado y distribución

El binario acepta `placitum-lsp [--stdio] [--version] [--help]
[--log-level=<error|info|debug|trace>] [--log-file=<ruta>]`. `--stdio` es el
único transporte; `--node-ipc` y `--socket` se rechazan con exit 2. Los logs
van a stderr o al archivo; stdout solo lleva frames JSON-RPC.

- Paquete npm `placitum-lsp`, `"type": "module"`, Node `>=20`.
- `bin`: `placitum-lsp` → `dist/bin.js`.
- `exports`: `dist/server.js` para que la extensión lo bundlee.
- `files`: `dist`, `editors`, `README.md`, `CHANGELOG.md`, `LICENSE`,
  `AUTHORS`.
- `npm pack` no incluye `src/`, `tests/`, `scripts/` ni configuraciones.
- `npm run smoke:pack` empaqueta, instala el tarball en un proyecto temporal y
  corre un E2E crudo por stdio (`initialize`, E301, `shutdown`/`exit`, pureza de
  stdout).
- La extensión de VS Code bundlea el servidor y el núcleo en `server/dist/`; no
  hace falta instalar `placitum-lsp` globalmente.

### 21.10 Seguridad

- **No ejecución.** El servidor solo importa las fases puras del núcleo. Nunca
  importa `evaluator`, el runtime de `stdlib`, `host-bindings` ni
  `capability/guard`; las tablas de firmas son datos puros.
- **Sin procesos, red ni OS** en el código de features. `node:fs` solo se usa
  en `workspace/files.ts` (lectura de archivos del workspace) y `log.ts`
  (archivo de log).
- **Sin escrituras directas.** Las ediciones se devuelven como `WorkspaceEdit`;
  el servidor no escribe archivos del usuario.
- **Texto no confiable.** Nunca `eval`, nunca `require(userInput)`, nunca shell
  out. Un `.placitum` malicioso solo produce diagnósticos.
- **Pureza de stdout.** Un test e2e parsea todo stdout y falla si aparece
  cualquier cosa que no sea un frame JSON-RPC.
- **Fallo contenido.** Un handler que lanza se registra y devuelve un resultado
  seguro o un error JSON-RPC; no tumba la conexión.
- **Sin telemetría** ni llamadas de red.

### 21.11 Límites conocidos

- Solo análisis single-file: no hay imports, módulos ni rename cross-file.
- No hay formateo (`textDocument/formatting`).
- No hay type-checker completo: solo errores demostrables.
- No hay grammar tree-sitter propia; el resaltado depende del cliente o de los
  semantic tokens.
- Los workspace symbols se escanean on demand, con cap de 2000 archivos y sin
  índice persistente.
- Los inlay hints están desactivados por defecto.
- No hay binario standalone: el cliente necesita Node o el bundle de la
  extensión.
- Pull diagnostics solo para clientes que lo declaran; el resto usa push.
- Los deltas de semantic tokens son un solo edit por respuesta (prefijo/sufijo
  común), no una secuencia mínima óptima.
- Los errores de runtime no son diagnósticos.

---

## 22. Ciclo de desarrollo

### 22.1 Núcleo del lenguaje

El núcleo se construyó por fases (0–9), con un gate de CI al cerrar cada una:
scaffolding, lexer, parser/AST, extractor de capabilities, guard, evaluador,
`explain`, CLI/empaquetado y endurecimiento. Las fases 7 (modo agente) y 8
(`rewind`) quedaron diferidas por decisión de alcance. El gate es
`npm run ci` (check-deps → typecheck → lint → build → tests).

Estado verificado el 17/11/2026: **26 archivos, 199/199 pruebas**, typecheck y
build OK. El paquete se publica en npm como `placitum`.

### 22.2 Servidor LSP

#### 22.2.1 Requisitos

| Herramienta / cuenta | Para qué |
|---|---|
| Node.js >= 20 (22 recomendado) | Runtime del servidor. |
| npm | Dependencias y publicación. |
| Nix con flakes + direnv (opcional) | Dev shell reproducible con Node 22. |
| Editor compatible con LSP | Neovim, Helix, Emacs, Vim, Zed, VS Code, etc. |
| Cuenta npm | Publicar `placitum-lsp` (si corresponde). |

No hace falta instalar el núcleo globalmente: `placitum` es una dependencia npm
del servidor.

#### 22.2.2 Entorno

```bash
cd pl-lsp

# Dev shell opcional (Node 22)
nix develop

# Dependencias exactas del lockfile
npm ci

# Typecheck + lint + build + tests
npm run ci

# Solo tests (sin smoke de empaquetado)
npm test

# Build del servidor
npm run build

# Servidor listo para un cliente
node dist/bin.js --stdio
```

Para probar con un editor, el binario debe estar en `PATH` como
`placitum-lsp`:

```bash
npm link          # o: npm install -g .
placitum-lsp --version
```

#### 22.2.3 Fases y decisiones

El plan de referencia (`placitum-lsp-implementation.md`) se ejecutó por fases.
No se empezó una fase hasta que la anterior tuvo su gate verde.

| Fase | Objetivo | Decisión clave | Límite / nota |
|---|---|---|---|
| 0. Scaffold y contrato | Reutilizar el núcleo sin reimplementarlo | Adapter único (`core-adapter.ts`), versión fijada, TypeScript strict, allow-list y lint de fronteras | El núcleo ya traía el contrato; no hubo que modificarlo |
| 1. Servidor y diagnósticos | LSP real sobre stdio | Solo stdio; sync incremental; caché por versión; debounce 80 ms; push; logs a stderr | `$/setTrace` solo ajusta el log propio; el forwarding por mensaje queda pendiente |
| 2. Análisis | Entender el programa como el evaluador | Binder que espeja scopes; E500/E506; tipos por binding; solo errores seguros; E505; modelo de capabilities | Tipos no flow-sensitive; un AST recuperado no genera chequeos |
| 3. Navegación | Ir al origen, usos, rename y símbolos | `LocationLink` con fallback; rename scope-aware; workspace symbols on demand con cap y mtime | Sin índice persistente; propiedades de objetos solo desde literales; multi-root con prefijo de carpeta |
| 4. Inteligencia | Completar, explicar y colorear mientras se escribe | Completion por contexto; hover; signature con `piped`; semantic tokens AST-first; fallbacks de parse recuperado | Los tokens no cruzan líneas; el ranking de pipes es best-effort |
| 5. UX de capabilities | Cerrar el ciclo de la autoridad | Quick fixes recomputados; add-needs; code lens; inlay hints; manifiesto byte a byte | E303 se omitió por inaplicable; `explainDeferred` no se implementó; el add-needs usa el scope más cercano |
| 6. Compatibilidad | Servir al cliente más pobre posible | Contrato mínimo; fallbacks por capability; UTF-16; recetas por editor; matriz honesta | Zed, Kate, Sublime y coc.nvim quedaron pendientes por falta de superficie headless |
| 7. Release | Paquete instalable en máquina limpia | Snapshot de `npm pack`; smoke de tarball; LICENSE/AUTHORS; handoff de VS Code | La revisión del handoff y el `vsce package` pertenecen al repo de la extensión |
| 8. Futuro opcional | Mejoras posteriores | Pull diagnostics, delta de semantic tokens y multi-root implementados | Faltan publicar 0.1.1, grammar tree-sitter y binario standalone |

Decisiones transversales:

- **No ejecutar código.** El servidor solo usa lex, parse, extract y explain.
  Esta es la invariante de seguridad principal.
- **No duplicar el núcleo.** El adapter aísla la versión y la API; si el núcleo
  cambia, se toca un solo archivo.
- **TDD y gates.** Primero el test/fixture que falla; después la
  implementación. Los goldens se actualizan con `UPDATE_GOLDENS=1` y en CI
  siempre se comparan.
- **Tres niveles de prueba.** Unit (funciones puras), protocolo in-process
  (cliente y servidor sobre `PassThrough`, sin subproceso) y e2e (spawn del
  binario, framing crudo, Neovim headless y empaquetado).
- **Sin `any`.** TypeScript strict, sin `@ts-ignore` ni `@ts-expect-error`.
- **Fronteras de import.** ESLint prohíbe `placitum/*` fuera del adapter y
  `fs`/procesos/red fuera de los dos archivos permitidos.
- **stdout puro.** Un test e2e verifica que todo stdout sea JSON-RPC.
- **Manifiesto sin re-render.** `placitum/manifest` usa el `explain` del núcleo
  para que el editor y la CLI muestren exactamente lo mismo.

#### 22.2.4 Flujo de trabajo

1. Leer la fase y su gate en `placitum-lsp-implementation.md`.
2. Escribir el test o fixture que falla por la razón correcta.
3. Implementar la menor superficie que lo hace pasar.
4. Correr `npm run ci` hasta que esté verde.
5. Probar a mano en un editor (`:LspRestart`, abrir un fixture).
6. Actualizar `docs/PHASES.md` y `CHANGELOG.md` al cerrar la fase.

#### 22.2.5 Pruebas y CI

```bash
npm test           # 292 pruebas, 35 archivos
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # tsc -p tsconfig.build.json
npm run ci         # check-deps → typecheck → lint → build → test → smoke:pack
```

`smoke:pack` requiere red (instala el núcleo desde npm) y tarda
aproximadamente 35 s; por eso cierra `npm run ci` pero no `npm test`. En una
máquina sin red, usar `npm test`.

Estado verificado el 17/11/2026: **35 archivos, 292/292 pruebas**, typecheck,
lint, build y `smoke:pack` OK.

#### 22.2.6 Empaquetado e instalación local

```bash
npm run build
npm pack
npm install -g ./placitum-lsp-0.1.1.tgz
placitum-lsp --version
```

También se puede usar `npm link` en desarrollo. El paquete no incluye `src/`,
`tests/`, `scripts/` ni configuraciones; sí incluye `dist/`, `editors/`,
README, CHANGELOG, LICENSE y AUTHORS.

Para la extensión de VS Code, el servidor se bundlea dentro de
`server/dist/`; no se instala globalmente.

#### 22.2.7 Versionado y publicación

1. Actualizar `package.json` y `src/version.ts` (el test exige que coincidan).
2. Actualizar `CHANGELOG.md` con la versión nueva.
3. Verificar la versión del núcleo en `package.json` y `docs/CORE-VERSION.md`.
4. Correr `npm run ci`.
5. `npm publish` (ejecuta `prepublishOnly`: check-deps, typecheck, lint, build y
   tests).
6. Crear el tag `vX.Y.Z` y publicar el release.

Estado actual: `0.1.1` preparado en el repo; npm tiene publicado `0.1.0`. La
publicación de `0.1.1` queda pendiente.

#### 22.2.8 Checklist de release

- [ ] `npm ci`
- [ ] `npm run ci` verde
- [ ] Versión sincronizada en `package.json` y `src/version.ts`
- [ ] `CHANGELOG.md` actualizado
- [ ] `docs/CORE-VERSION.md` actualizado si cambió el núcleo
- [ ] `npm pack --dry-run` muestra solo los archivos esperados
- [ ] `npm run smoke:pack` verde
- [ ] Tag `vX.Y.Z`
- [ ] `npm publish`
- [ ] Verificación post-publicación con `npm install -g placitum-lsp` y un
      editor limpio

#### 22.2.9 Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| El servidor no arranca | `placitum-lsp --version`; verificar Node >= 20 y que esté en `PATH`. |
| No hay diagnósticos | Confirmar filetype `placitum` y que el archivo esté abierto (`didOpen`). |
| No hay logs | Usar `--log-level=debug` o `trace`; los logs van a stderr. |
| Helix sin resaltado | Falta grammar tree-sitter; las features LSP no dependen de él. |
| No aparece el manifiesto | Usar `placitum/manifest` o `npx placitum explain <archivo>`. |
| `--version` muestra otra versión | El `dist/` está viejo: `npm run build`. |
| `smoke:pack` falla | Requiere red para instalar el núcleo desde npm. |

### 22.3 Extensión de VS Code

La extensión se desarrolla en su propio repositorio (`pl-vscode`). El ciclo
resumido es:

1. **Entorno:** Node 22, VS Code 1.90+, `npm ci`, `npm run bundle:server`,
   `npm run build`.
2. **Desarrollo:** abrir `pl-vscode` en VS Code, **F5** (Extension Development
   Host), abrir una carpeta con un `.placitum` y aceptar **Trust**.
3. **Cambios del servidor:** publicar `placitum`/`placitum-lsp`, fijar las
   versiones exactas en la extensión, re-bundlear y recargar la ventana.
4. **Pruebas:** `npm run test:guard`, `npm run smoke:server`,
   `npm run smoke:cli`, `npm run smoke:wrapper` y `npm run package`.
5. **Empaquetado:** `vsce package` genera el `.vsix`; instalar con
   **Install from VSIX...** o `code --install-extension`.
6. **Publicación:** tag `vX.Y.Z` y pipeline con Trusted Publishing (GitHub
   Actions) o Managed Identity (Azure Pipelines); la publicación manual del
   `.vsix` es la alternativa sin CI. Los PAT globales están en retiro.

La guía operativa completa, con comandos y solución de problemas, está en
`docs/DESARROLLO-Y-PUBLICACION.md`.

---

## 23. Pruebas

### 23.1 Resumen de ejecución

| Componente | Comando | Resultado verificado |
|---|---|---|
| Núcleo `pl-lg` | `npm run ci` | 26 archivos, **199/199** pruebas; typecheck y build OK |
| Servidor `pl-lsp` | `npm run ci` | 35 archivos, **292/292** pruebas; typecheck, lint, build y `smoke:pack` OK |
| Extensión `pl-vscode` | `npm run test:guard` + smokes | 8/8 guards y 3 smokes, según el repositorio de la extensión |
| Extensión `pl-vscode` | `npm run package` | `.vsix` generado, según el repositorio de la extensión |

La verificación del núcleo y del servidor se ejecutó el **17/11/2026** en los
checkouts locales. El checkout del núcleo declara `1.0.0`; la versión publicada
en npm es `1.0.1`. La extensión no está en este repositorio; sus resultados se
toman de su documentación y no se reejecutaron aquí.

### 23.2 Programas válidos

| # | Programa | Objetivo | Entrada | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|---|
| 1 | `rosetta` | Recorrer todo el lenguaje y ejecutar el pipeline completo | `pl-lg/examples/rosetta.placitum` | Golden `tests/eval/rosetta.eval.golden.json` | Coincide con el golden | Pasa |
| 2 | `control-flow` | Closures, pipes, ciclos y tabla de verdad | `pl-lg/tests/eval/control-flow.placitum` | Golden `tests/eval/control-flow.eval.golden.json` | Coincide con el golden | Pasa |
| 3 | `kitchen-sink` (parser) | Cobertura sintáctica completa | `pl-lg/tests/parser/kitchen-sink.placitum` | Golden `tests/parser/kitchen-sink.ast.golden.json` | Coincide con el golden | Pasa |
| 4 | `kitchen-sink` (capability) | Manifiesto de un programa con grants | `pl-lg/tests/capability/kitchen-sink.placitum` | Golden `tests/capability/kitchen-sink.manifest.golden.json` | Coincide con el golden | Pasa |
| 5 | `rosetta` (parser) | Ejemplo canónico del AST | `pl-lg/tests/parser/rosetta.placitum` | Golden `tests/parser/rosetta.ast.golden.json` | Coincide con el golden | Pasa |

Los programas 1 y 2 se ejecutan; los programas 3–5 validan el análisis
estático (AST y manifiesto), que es una forma válida de programa en el
proyecto. Todos forman parte de la suite automatizada del núcleo y la
comparación con el golden es exacta.

### 23.3 Errores sintácticos

| # | Fixture | Objetivo | Entrada | Esperado | Obtenido | Estado |
|---|---|---|---|---|---|---|
| 1 | `e101-unterminated-string` | Detectar string sin cerrar | `let s = "abc` | E101 | E101 | Pasa |
| 2 | `e104-bare-bang` | Detectar `!` mal ubicado | `let b = !x` | E104 | E104 | Pasa |
| 3 | `e201-missing-expr` | Detectar expresión faltante | `let x =` | E201 | E201 | Pasa |
| 4 | `e203-unterminated-block` | Detectar bloque sin cerrar | `fn f() { let x = 1` | E203 | E203 | Pasa |
| 5 | `e206-duplicate-param` | Detectar parámetro duplicado | `fn f(a, a) { }` | E206 | E206 | Pasa |

### 23.4 Errores semánticos

| # | Fixture | Objetivo | Entrada | Esperado | Obtenido | Estado |
|---|---|---|---|---|---|---|
| 1 | `e500-unbound-read` | Detectar lectura de nombre no ligado | `let copy = missing_name` | E500 | E500 | Pasa |
| 2 | `e501-type-mismatch` | Detectar mezcla de tipos | `let s = 1 + "a"` | E501 | E501 | Pasa |
| 3 | `e503-arity-mismatch` | Detectar aridad incorrecta | `fn f(a) { return a }` + `f(1, 2)` | E503 | E503 | Pasa |
| 4 | `e504-division-by-zero` | Detectar división por cero | `let q = 1 / 0` | E504 | E504 | Pasa |
| 5 | `e506-let-redeclaration` | Detectar redeclaración | `let x = 1` + `let x = 2` | E506 | E506 | Pasa |

### 23.5 Pruebas de importaciones

Placitum no tiene imports; la exclusión fue autorizada por el docente
(sección 15). Por eso las pruebas de importación **no aplican** y no se
inventaron resultados. La tabla documenta el objetivo y el motivo.

| # | Prueba | Objetivo | Entrada | Esperado | Obtenido | Estado |
|---|---|---|---|---|---|---|
| 1 | Importación simple | Verificar que un archivo puede usar otro | N/A | N/A | N/A | N/A — exclusión autorizada |
| 2 | Importación con símbolos | Verificar reutilización de funciones entre archivos | N/A | N/A | N/A | N/A — exclusión autorizada |
| 3 | Importación con error | Verificar el reporte de errores en un archivo importado | N/A | N/A | N/A | N/A — exclusión autorizada |
| 4 | Importación circular | Verificar la detección de ciclos | N/A | N/A | N/A | N/A — exclusión autorizada |

**Evidencia de ausencia.** Una línea `import "otro.placitum"` no es una
declaración del lenguaje: el parser la rechaza con E201. No hay módulos,
símbolos importados ni ciclos que detectar.

### 23.6 Caso de estudio completo

**Problema:** auditar el estado de tres servicios y generar un reporte.

**Objetivo:** demostrar el uso combinado de `needs`, lectura de archivo, JSON,
funciones, condicionales, ciclos y escritura de archivo bajo capabilities.

**Entrada (`services.json`):**

```json
{
  "services": [
    { "name": "gateway", "status": 200 },
    { "name": "billing", "status": 503 },
    { "name": "search", "status": 404 }
  ]
}
```

**Programa (`audit.placitum`):**

```placitum
#!strict

needs fs.read("**/services.json"), fs.write("**/report.txt"), env(REPORT_MODE?)

fn classify(status) {
    if status >= 200 && status < 300 {
        return "ok"
    }
    if status >= 500 {
        return "critical"
    }
    return "warning"
}

let raw = fs.readFile!("./services.json") | json.parse
let total = 0
let ok = 0

for service in raw.services {
    total = total + 1
    let verdict = classify(service.status)
    if verdict == "ok" {
        ok = ok + 1
    }
    print!(f"{service.name}: {verdict}")
}

fs.writeFile!("./report.txt", f"total={total} ok={ok}")
print!(f"report written: {ok}/{total} ok")
```

> El script se ejecuta desde su propio directorio; los grants usan `**/` para
> que la ruta canónica quede cubierta. La verificación se ejecutó en un
> directorio temporal el 17/11/2026.

**Resultado esperado:**

```text
gateway: ok
billing: critical
search: warning
report written: 1/3 ok
```

**Resultado obtenido:**

```text
gateway: ok
billing: critical
search: warning
report written: 1/3 ok
```

**Archivo `report.txt` obtenido:**

```text
total=3 ok=1
```

**Estado:** pasa (verificación manual con el CLI; no forma parte de la suite
automatizada).

**Manifiesto obtenido con `placitum explain`:**

```text
grants (statically proven):
  fs.read   **/services.json
  fs.write  **/report.txt
  exec      (none)
  net       (none)
  env       REPORT_MODE (optional)

deferred to runtime:
  (none)
```

### 23.7 Pruebas del servidor LSP

| Suite | Archivos | Pruebas | Qué cubre |
|---|---|---|---|
| Unitarias | 25 | 213 | Binder, tipos, checks, posiciones, comentarios, completion, hover, signature, rename, símbolos, semantic tokens, folding, code actions, code lens, inlay hints, manifiesto, configuración, adapter y performance. |
| Protocolo | 6 | 63 | Ciclo de vida, capabilities, diagnósticos, navegación, inteligencia y compatibilidad; cliente in-process sobre `PassThrough`. |
| End-to-end | 4 | 16 | stdio crudo y pureza de stdout, Neovim headless con la receta publicada, lint de recetas y snapshot/instalación del tarball. |
| **Total** | **35** | **292** | `npm run ci` verde. |

Cobertura destacada:

- Diagnósticos con rango exacto, incluidos emojis UTF-16 y archivos con CRLF.
- Recuperación de parse: un archivo roto no tumba el servidor.
- Rename scope-aware con sombreado y rechazo de keywords/colisiones.
- Manifiesto byte a byte contra `explain` del núcleo (Rosetta).
- Add-needs en sus seis variantes: sin `needs`, con `needs`, con pragma,
  duplicado, hostname en minúsculas y escaping.
- Pull diagnostics full/unchanged y delta de semantic tokens que reconstruye el
  stream.
- `npm pack` no filtra fuentes, tests, scripts ni configuraciones.
- Pureza de stdout en un E2E crudo.

### 23.8 Cobertura y limitaciones

- La suite automatizada es amplia en el núcleo y el servidor; no se abrió VS
  Code de forma interactiva. Se usaron smokes, guards y lectura de código.
- El caso de estudio es manual; se recomienda incorporarlo como fixture.
- No hay pruebas de imports/circular por la exclusión autorizada.
- Zed, Kate, Sublime y coc.nvim no se pudieron verificar headless; se reportan
  como pendientes, no como aprobados.
- La extensión no está en este repositorio; sus resultados se toman de su
  documentación.

---

## 24. Contribuciones de los integrantes

| Integrante | Evidencia en Git | Contribución principal |
|---|---|---|
| Matteo Vargas | ~26 commits en `pl-lg` | Núcleo del lenguaje: lexer, parser, extractor, guard, evaluador, CLI, pruebas y documentación |
| Aryel Rivera | ~15 commits en `pl-lg`, ~20 en `pl-lsp` | Servidor LSP: análisis, features, compatibilidad, pruebas de protocolo y documentación |
| Kristel Montoya | ~3 en `pl-lg`, ~7 en `pl-lsp`, ~35 en `pl-vscode` | Extensión de VS Code, integración, empaquetado, publicación y documentación |

Los tres nombres figuran en `AUTHORS` de los tres repositorios. La colaboración
técnica es visible en commits que tocan `src`, `tests` y documentación. La
participación en la presentación/defensa no es verificable desde el
repositorio; debe evidenciarse en la defensa individual.

---

## 25. Conclusiones

Placitum cumple el núcleo del proyecto: un lenguaje con sintaxis, semántica,
tipos, funciones, control de flujo, operadores, ejecución y una innovación
técnica real (capabilities con verificación estática y runtime). La extensión
de VS Code cubre el entorno gráfico y el servidor LSP aporta la experiencia de
editor.

Con la autorización del docente, el multiarchivo/imports/main se presenta como
una exclusión de alcance justificada, no como un fallo. La justificación se
apoya en el modelo de seguridad del lenguaje y en el workspace de VS Code, y
reconoce su límite: no hay reutilización de funciones entre archivos.

El servidor LSP quedó completo en sus fases 0–7, con la fase 8 parcial (pull
diagnostics, delta de semantic tokens y multi-root implementados). La suite del
servidor está verde (292/292) y el paquete pasa el smoke de instalación en
máquina limpia.

Quedan tareas de entrega: publicar `placitum-lsp@0.1.1` en npm, revisar el
handoff de la extensión, generar el proyecto de ejemplo en carpeta, el manual
de usuario y la presentación. El núcleo técnico y las pruebas están en buen
estado; el riesgo principal está en la publicación de npm y en la justificación
de las exclusiones.

---

## 26. Referencias

1. Saltzer, J. H., & Schroeder, M. D. (1975). The Protection of Information in
   Computer Systems. *Proceedings of the IEEE*, 63(9), 1278–1308.
   <https://doi.org/10.1109/PROC.1975.9939>
2. Dennis, J. B., & Van Horn, E. C. (1966). Programming Semantics for
   Multiprogrammed Computations. *Communications of the ACM*, 9(3), 143–155.
   <https://doi.org/10.1145/365230.365252>
3. Miller, M. S. (2006). *Robust Composition: Towards a Unified Approach to
   Access Control and Concurrency Control*. Tesis doctoral, Johns Hopkins
   University.
4. Watson, R. N. M., Anderson, J., Laurie, B., & Kennaway, K. (2012). Capsicum:
   Practical Capabilities for UNIX. *USENIX Security Symposium*.
   <https://www.usenix.org/conference/usenixsecurity12/technical-sessions/presentation/watson>
5. NIST. *Security and Privacy Controls for Information Systems and
   Organizations* (SP 800-53 Rev. 5), control AC-6, Least Privilege.
   <https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final>
6. Microsoft. *Language Server Protocol Specification*.
   <https://microsoft.github.io/language-server-protocol/>
7. Visual Studio Code. *Language Server Extension Guide*.
   <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
8. Visual Studio Code. *Extension Manifest*.
   <https://code.visualstudio.com/api/references/extension-manifest>
9. GNU. *Bash Reference Manual*.
   <https://www.gnu.org/software/bash/manual/>
10. Microsoft. *Publishing Extensions*.
    <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>

**Documentación interna del proyecto:**

- `placitum-lsp-implementation.md` — directiva y plan de referencia del LSP.
- `docs/PHASES.md` — bitácora por fase del LSP.
- `docs/COMPATIBILITY.md` — matriz de compatibilidad por capability y editor.
- `docs/VSCODE-HANDOFF.md` — contrato de integración con la extensión.
- `docs/DESARROLLO-Y-PUBLICACION.md` — ciclo operativo de la extensión.
- `docs/CORE-VERSION.md` — pin y contrato del núcleo.

---

## 27. Anexos

### A. Glosario

- **Capability:** autoridad explícita para realizar un efecto.
- **Bang call:** llamada con `!` a un builtin con efecto.
- **Grant:** permiso declarado en `needs`.
- **Manifiesto:** representación serializada de los grants y verificaciones.
- **Guard:** componente que autoriza en runtime.
- **Atenuación:** reducción de autoridad con `needs only(...)`.
- **LSP:** Language Server Protocol.
- **JSON-RPC:** formato de mensajes del LSP.
- **stdio:** transporte por entrada/salida estándar; stdout solo lleva frames.
- **Span:** par `[start, end)` de offsets UTF-16 sobre el texto.
- **Binder:** pase de análisis que resuelve scopes, bindings y ocurrencias.
- **Deferred:** chequeo de capability que no se puede probar estáticamente y
  se difiere al runtime.
- **Golden:** archivo de resultado esperado que se compara en CI.

### B. Comandos útiles

```bash
# Núcleo
cd pl-lg
nix develop --command npm ci
nix develop --command npm run ci
nix develop --command node dist/cli/bin.js run examples/rosetta.placitum
nix develop --command node dist/cli/bin.js explain examples/rosetta.placitum

# Servidor LSP
cd ../pl-lsp
nix develop --command npm ci
nix develop --command npm run ci
nix develop --command npm run build
node dist/bin.js --version
node dist/bin.js --stdio

# Extensión
cd ../pl-vscode
nix develop --command npm ci
nix develop --command npm run bundle:server
nix develop --command npm run build
nix develop --command npm run test:guard
nix develop --command npm run smoke:server
nix develop --command npm run smoke:cli
nix develop --command npm run smoke:wrapper
nix develop --command npm run package
```

### C. Ejemplo de error

```text
error[E301_EXTRACT_UNCOVERED_CAPABILITY]: fs.readFile!("config.json") has a compile-time-literal target that no in-scope needs fs.read(...) token covers.
  --> script.placitum:3:11
   |
 3 | let config = fs.readFile!("config.json") | json.parse
   |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |
   = hint: Add needs fs.read("config.json") at the top of the script, or delete the call.
```

### D. Matriz de cumplimiento del entregable

| Requisito | Sección | Estado |
|---|---|---|
| Portada | Portada | Cumple |
| Tabla de contenidos | Tabla de contenidos | Cumple |
| Introducción | 1 | Cumple |
| Planteamiento del problema | 2 | Cumple |
| Evidencias de investigación | 2.5 | Cumple |
| Propuesta de solución | 3 | Cumple |
| Objetivos | 4 | Cumple |
| Alcance y limitaciones | 5 | Cumple |
| Descripción del lenguaje | 6 | Cumple |
| Palabras reservadas | 7 | Cumple |
| Sintaxis | 8 | Cumple |
| Semántica | 9 | Cumple |
| Tipos de datos | 10 | Cumple |
| Funciones | 11 | Cumple |
| Estructuras de control | 12 | Cumple |
| Operaciones | 13 | Cumple |
| Organización de archivos | 14 | Cumple |
| Importaciones | 15 | Exclusión autorizada |
| Proceso de compilación | 16 | Cumple (análisis, sin codegen) |
| Proceso de ejecución | 17 | Cumple |
| Manejo de errores | 18 | Cumple |
| Innovación | 19 | Cumple |
| Arquitectura del aplicativo | 20 y 21 | Cumple |
| Pruebas | 23 | Cumple; imports N/A justificado |
| Contribuciones de los integrantes | 24 | Cumple |
| Conclusiones | 25 | Cumple |
| Referencias | 26 | Cumple |
| Anexos | 27 | Cumple |

### E. Notas de entrega

- Este documento es la fuente de revisión; la versión final se entrega en PDF.
- Las secciones 21 y 22 son la documentación específica del LSP y su ciclo de
  desarrollo.
- Las secciones 23.2–23.6 cubren los mínimos de pruebas del enunciado; 23.5
  documenta la exclusión autorizada de importaciones.
- La documentación operativa de la extensión se mantiene en
  `docs/DESARROLLO-Y-PUBLICACION.md`.
