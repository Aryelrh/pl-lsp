# Placitum

![Logotipo de Placitum](placitum-logo-set/svg/placitum-rounded.svg)

<p class="cover-subtitle">Documentación del proyecto</p>

<div class="cover-meta">
<p><strong>Universidad Nacional — Sede Regional Brunca</strong><br>
<strong>Campus Pérez Zeledón</strong><br>
<strong>Curso:</strong> Paradigmas de Programación<br>
<strong>Profesores:</strong> Pablo A. Venegas Elizondo · Josias Ariel Chaves Murillo</p>

<p><strong>Integrantes:</strong><br>
Matteo Vargas<br>
Kristel Montoya<br>
Aryel Rivera</p>

<p><strong>Versiones:</strong> núcleo <code>placitum</code> 1.0.1 · servidor <code>placitum-lsp</code> 0.1.1 · extensión <code>placitum-vscode</code> 0.1.3<br>
<strong>Fecha:</strong> noviembre de 2026</p>
</div>

---

## Resumen

Placitum es un lenguaje de shell orientado a scripts con **capabilities**: cada
script declara en una cláusula `needs` qué archivos, hosts y variables de
entorno puede tocar. Los usos con argumentos literales se verifican
estáticamente antes de ejecutar y el resto se controla en runtime con un guard.
No existe acceso ambiental implícito al sistema de archivos, la red ni el
entorno.

El proyecto incluye el núcleo del lenguaje (`pl-lg`), un servidor de Lenguaje
(LSP) que solo analiza (`pl-lsp`) y una extensión de VS Code (`pl-vscode`) que
aporta el editor, el árbol de archivos, los diagnósticos y la ejecución. La
innovación principal es el modelo de capabilities con manifiesto estático,
atenuación por función y verificación en runtime.

Este documento reúne el planteamiento del problema, la propuesta de solución,
el diseño del lenguaje, la arquitectura, las pruebas y las **decisiones de
alcance autorizadas por el docente**, en particular la exclusión del
multiarchivo y de las importaciones entre archivos.

## 1. Introducción

Los lenguajes de shell son la herramienta natural para automatizar tareas:
leer configuración, consultar servicios, transformar datos y escribir
resultados. Su comodidad tiene un costo: un script se ejecuta con la autoridad
ambiental del usuario. Si el script lee `/etc/passwd`, escribe en el home o
llama a cualquier host, el sistema operativo no distingue si esa era la
intención del programa.

Placitum explora una alternativa: un lenguaje pequeño, de sintaxis familiar,
en el que **todo efecto es visible en el código** y debe estar declarado antes
de ejecutarse. La declaración `needs` es la fuente de verdad; el compilador
prueba lo que puede probar y el runtime bloquea lo que no está concedido.

El documento está organizado para cubrir los requisitos del proyecto y para
dejar explícitas dos cosas: qué se implementó y qué se excluyó con
justificación. Las secciones 13 y 20 explican el modelo de proyecto y las
exclusiones autorizadas; las secciones 19 y 21 presentan la evidencia de
pruebas y las contribuciones.

## 2. Planteamiento del problema

### 2.1 Problema y motivación

Un script de shell típico se ejecuta con la misma autoridad que el usuario que
lo invoca. Puede leer cualquier archivo accesible, abrir conexiones de red,
leer variables de entorno y escribir donde tenga permiso. El código no declara
esa intención y el sistema operativo no la conoce: solo aplica permisos
gruesos por usuario, grupo o proceso.

Esto genera tres problemas:

1. **Efectos invisibles.** Al revisar un script no se sabe, a simple vista, qué
   recursos externos toca. Un `curl` escondido en una función o un
   `readFile` dentro de un pipe pasan desapercibidos.
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

Ninguna de estas soluciones ofrece, dentro del propio lenguaje, una declaración
de intención legible, una prueba estática de los usos literales y un guard de
runtime para los valores dinámicos.

### 2.5 Cómo Placitum contribuye

Placitum introduce cuatro ideas articuladas:

1. **Declaración explícita.** `needs fs.read("data/*.json"), net("api.example.com")`
   enumera la autoridad del script.
2. **Efectos sintácticamente visibles.** Los builtins con efecto solo se
   alcanzan como *bang calls*: `fs.readFile!`, `fs.writeFile!`, `curl!`. No hay
   alias sin `!` ni forma de obtener una referencia de primera clase a un
   efecto.
3. **Doble verificación.** El extractor prueba estáticamente todo bang call con
   primer argumento literal (E301 si no está cubierto). El guard canonicaliza
   el valor real en runtime y aplica el grant (E401–E406).
4. **Manifiesto y atenuación.** `placitum explain` muestra lo probado y lo
   diferido; una función puede declarar `needs only(...)` para reducir su
   autoridad.

### 2.6 Relación entre necesidades y características

| Necesidad identificada | Característica de Placitum | Evidencia |
|---|---|---|
| Saber qué recursos toca un script | Cláusula `needs` | `pl-lg/README.md:246-275` |
| Ver los efectos en el código | Bang calls `nombre!(...)` | `pl-lg/README.md:220-244` |
| Detectar usos no declarados antes de ejecutar | Prueba estática E301 | `pl-lg/tests/capability/negative/` |
| Bloquear valores dinámicos fuera del grant | Guard runtime E401–E406 | `pl-lg/tests/guard/` |
| Revisar la autoridad sin ejecutar | `placitum explain` | `pl-lg/tests/explain/` |
| Reducir permisos en funciones auxiliares | `needs only(...)` | `pl-lg/README.md:180-199` |
| Tener retroalimentación en el editor | LSP y extensión VS Code | `pl-lsp/README.md`, `pl-vscode/README.md` |

### 2.7 Evidencias de investigación

El diseño se apoya en principios consolidados de seguridad:

- **Mínimo privilegio:** un sujeto debe tener solo la autoridad necesaria para
  su tarea (Saltzer y Schroeder, 1975).
- **Seguridad basada en capabilities:** la autoridad se representa mediante
  tokens no falsificables, no mediante identidades globales (Dennis y Van Horn,
  1966).
- **Modelo de object-capabilities:** la autoridad se compone y se atenúa al
  pasarla entre objetos/funciones (Miller, 2006).
- **Capabilities prácticas en UNIX:** Capsicum demuestra que el modelo se puede
  aplicar a procesos reales (Watson et al., 2012).
- **Menor privilegio en sistemas:** NIST SP 800-53, control AC-6.

Placitum traslada esas ideas al nivel del lenguaje de scripting: la autoridad
se declara en el fuente, se prueba estáticamente cuando es literal y se aplica
en runtime cuando es dinámica.

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

### 3.3 Alcance

Incluido:

- Lenguaje de scripting de un solo archivo, con sintaxis, tipos, funciones,
  control de flujo, operadores, pipes y capabilities.
- Análisis estático y guard de runtime.
- CLI `placitum` con `run` y `explain`.
- Servidor LSP y extensión de VS Code.
- Pruebas automatizadas y documentación.

Excluido y justificado en la sección 20:

- Importaciones entre archivos y archivo principal.
- Entrada interactiva por stdin.
- Separación entre enteros y flotantes.
- Botón de compilación separado e IDE propio.

### 3.4 Limitaciones

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
- El lenguaje es interpretado; no genera código objeto.
- No hay warnings: los diagnósticos actuales son errores.

### 3.5 Beneficios esperados

- Autoridad visible y revisable antes de ejecutar.
- Menor impacto de un script copiado o generado por IA.
- Errores con archivo, línea y sugerencia.
- Integración con el editor sin instalar el servidor globalmente.
- Modelo pequeño y enseñable.

### 3.6 Características principales

- `needs` y atenuación `only(...)`.
- Bang calls y builtins de efecto.
- Verificación estática + guard runtime.
- `placitum explain` y manifiesto.
- Tipos simples y compuestos, funciones de primera clase, closures.
- Pipes, condicionales, ciclos y operadores.
- Menú de referencia del lenguaje y estado de análisis en VS Code.
- CLI, LSP y extensión de VS Code.

### 3.7 Ejemplos de programas

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

### 3.8 Por qué un lenguaje nuevo

Agregar capabilities a bash requeriría cambiar su modelo de ejecución y su
sintaxis, y aun así quedarían formas de acceso ambiental. Un lenguaje pequeño
permite diseñar desde el inicio:

- una sintaxis que hace visibles los efectos (`!`),
- una declaración de autoridad (`needs`),
- un pipeline de análisis que puede probar los literales,
- un guard que controla los valores dinámicos,
- y un manifiesto que se puede mostrar al usuario.

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

## 5. Identidad del lenguaje

### 5.1 Nombre, propósito y usuarios

- **Nombre:** Placitum.
- **Propósito:** scripting con autoridad explícita y verificable.
- **Usuarios:** operaciones, desarrollo, CI/CD, agentes de IA y estudiantes.
- **Extensión:** `.placitum`.
- **Implementación:** TypeScript sobre Node.js 20+.

### 5.2 Extensión y logotipo

La extensión de archivo es `.placitum`. El logotipo oficial es la marca
pixel-art del set `docs/placitum-logo-set`: un personaje con paleta cian, azul,
blanco y tonos oscuros. El set incluye versiones cuadrada, redondeada, circular,
transparente y monocroma; la portada usa `placitum-rounded.svg`.

### 5.3 Filosofía de diseño

- **Un script, una autoridad.** El manifiesto pertenece a la invocación.
- **Efectos visibles.** Todo builtin con efecto se escribe con `!`.
- **Confianza mínima.** El evaluador y la stdlib no tienen I/O; solo
  `host-bindings` toca el sistema.
- **Defensa en profundidad.** La prueba estática y el guard runtime son
  complementarios.
- **Fallo cerrado.** Sin grant, la operación se deniega con un error claro.
- **Herramientas primero.** El lenguaje se usa desde un editor con
  diagnósticos, no solo desde la terminal.

## 6. Palabras reservadas

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

`!` no es una palabra reservada: es la marca sintáctica de un bang call y debe
ir pegada al target (`fs.readFile!(...)`, no `fs.readFile !(...)`).

## 7. Sintaxis

### 7.1 Estructura del programa

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

### 7.2 Declaración y asignación

```placitum
let name = "valor"   # declaración con inicializador obligatorio
name = "otro"        # asignación a un binding existente
```

No hay `+=`, `++` ni declaración sin inicializador. Una redeclaración en el
mismo scope es E506; un scope interno puede sombrear.

### 7.3 Entrada y salida

La salida se hace con `print!` y `eprint!`. La entrada es **explícita**: no hay
stdin interactivo; se lee con `fs.readFile!`, se consulta con `curl!` o se
valida una variable de entorno con `env(...)`. Esta decisión es parte del
modelo de capabilities (sección 20.3).

```placitum
print!("resultado")
eprint!("diagnóstico")
```

### 7.4 Condicionales

```placitum
if score >= 5 {
    print!("healthy")
} else if score > 0 {
    print!("degraded")
} else {
    print!("down")
}
```

`else` debe seguir al `}` en la misma línea. Las condiciones usan la tabla de
verdad: `false`, `null`, `0` y `""` son falsy; los arrays y objetos son truthy.

### 7.5 Ciclos

```placitum
while retries > 0 {
    retries = retries - 1
}

for endpoint in config.endpoints {
    print!(endpoint)
}
```

`for..in` recorre únicamente arrays. No hay `break` ni `continue`.

### 7.6 Funciones

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

### 7.7 Operadores

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

### 7.8 Pipes y bang calls

```placitum
let config = fs.readFile!("app.json") | json.parse
print!("mid" | wrap("[", "]"))
let response = "https://api.example.com/health" | curl!({ method: "GET" })
```

Un pipe evalúa la etapa izquierda y la pasa como primer argumento de la etapa
derecha. Los builtins con efecto solo se alcanzan con `!` pegado al target.

### 7.9 Importaciones

El lenguaje **no incluye** `import` ni módulos. Cada archivo `.placitum` es
una unidad independiente. La organización de varios archivos se hace con el
workspace de VS Code. La justificación y la autorización del docente están en
las secciones 13.3 y 20.2.

## 8. Semántica

### 8.1 Inicio y bloques

Un programa comienza en la primera sentencia de nivel superior. Un `return` de
nivel superior termina el script con éxito. Los bloques `{}` delimitan scopes;
la indentación no cambia la semántica.

### 8.2 Variables y alcances

- `let` declara un binding en el scope actual.
- La asignación escribe el binding más cercano que exista; si no existe, E500.
- Cada bloque (`if`, `while`, `for`, función) es un scope.
- Los scopes internos pueden sombrear; el mismo scope no puede redeclarar
  (E506).
- Las funciones son closures: capturan el entorno y pueden mutar `let`
  externos.

### 8.3 Expresiones y verdad

Las expresiones se evalúan de izquierda a derecha con la precedencia de la
tabla 7.7. `&&` y `||` cortocircuitan. La verdad sigue la tabla:

| Valor | Truthy |
|---|---|
| `false`, `null`, `0`, `""` | No |
| `true`, números distintos de 0, strings no vacíos | Sí |
| arrays y objetos (incluidos vacíos) | Sí |
| funciones | Sí |

### 8.4 Condiciones y ciclos

`if` y `while` usan la verdad del valor; no imponen un tipo booleano. `for..in`
solo acepta arrays (E501 si no). El iterador vive solo dentro del cuerpo.

### 8.5 Llamadas y retorno

Una llamada evalúa el callee y los argumentos, verifica la aridad y ejecuta el
cuerpo en un nuevo scope. `return` devuelve un valor; sin argumento devuelve
`null`. Un `return` de nivel superior termina el script. Llamar un valor no
invocable es E502.

### 8.6 Importaciones

No aplica: el lenguaje no tiene imports. Cada script se analiza y ejecuta de
forma independiente. Esta es una exclusión de alcance autorizada (sección
20.2), no una importación implícita.

### 8.7 Errores

Cada fallo produce un sobre con código, fase, severidad, mensaje, ubicación y
sugerencia. La CLI sale con código 1; la ejecución sin error sale con 0. Los
errores de sintaxis impiden ejecutar; los errores de evaluación ocurren cuando
se alcanza la instrucción (ver limitación en 15.4).

## 9. Tipos de datos

### 9.1 Tipos simples

| Tipo | Declaración / uso | Operaciones permitidas | Restricciones |
|---|---|---|---|
| `string` | `"texto"`, `f"hola {name}"` | `+` con string, `==`, `!=`, print, pipes | Una línea; escapes `\n \t \r \\ \"`; sin `.length` ni métodos |
| `number` | `42`, `3.14`, resultados aritméticos | `+ - * /`, comparaciones, igualdad | IEEE double; no hay enteros separados; `/0` es E504; sin hex/exponente |
| `boolean` | `true`, `false` | `&&`, `\|\|`, `not`, igualdad | Solo dos valores |
| `null` | `null` | Igualdad, print | Falsy; no tiene operaciones propias |

### 9.2 Tipos compuestos

| Tipo | Declaración / uso | Operaciones permitidas | Restricciones |
|---|---|---|---|
| `array` | `[1, "dos"]`, `json.parse` | `for..in`, igualdad profunda, print/JSON | Sin indexación; solo arrays son iterables |
| `object` | `{ name: "app", enabled: true }` | `.member`, igualdad profunda, print/JSON | Claves identificador sin comillas; no es iterable; miembro faltante lee `null` |
| `function` | `fn`, `json.parse` | Llamar, pipear, pasar, retornar, guardar | Igualdad por identidad; imprimir muestra `[closure]`/`[native]` |

Los dos tipos compuestos exigidos por el enunciado son `array` y `object`; la
función es un tipo de primera clase adicional.

### 9.3 Operaciones y restricciones

- La igualdad `==`/`!=` es profunda para arrays y objetos; las funciones
  comparan por identidad.
- Los números son IEEE double; `10 / 4` es `2.5`.
- No se mezclan números y strings con `+`.
- Los arrays no se indexan; se recorren con `for..in`.
- Los objetos no se iteran; se accede a members conocidos.
- Los tipos no se declaran explícitamente; se infieren en runtime y el LSP
  infiere tipos estáticamente cuando puede.

La decisión de un solo tipo numérico se justifica en la sección 20.4.

## 10. Funciones

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

## 11. Estructuras de control

| Estructura | Sintaxis | Uso |
|---|---|---|
| Condicional simple | `if cond { ... }` | Ejecuta un bloque si la condición es truthy |
| Condicional con alternativa | `if cond { ... } else { ... }` | Dos ramas |
| Condicional múltiple | `if cond1 { ... } else if cond2 { ... } else { ... }` | Cadena de alternativas |
| Ciclo mientras | `while cond { ... }` | Repite mientras la condición sea truthy |
| Ciclo sobre array | `for item in array { ... }` | Itera elementos de un array |

No hay `break`, `continue`, `switch` ni `do..while`. La combinación de `if`,
`while`, `for` y funciones cubre los casos del proyecto.

## 12. Operaciones

### 12.1 Aritméticas

`+`, `-`, `*`, `/` sobre números. `+` también concatena strings del mismo tipo.
La división por cero es E504.

### 12.2 Lógicas

`&&`, `||`, `not`. `&&` y `||` cortocircuitan y devuelven un booleano según la
tabla de verdad.

### 12.3 Relacionales

`==`, `!=`, `<`, `<=`, `>`, `>=`. Las comparaciones de orden son solo para
números; la igualdad es profunda para arrays/objetos y por identidad para
funciones.

### 12.4 Pipes

`|` encadena etapas. Cada etapa recibe el valor anterior como primer argumento:

| Etapa | Llamada equivalente |
|---|---|
| `name` / `obj.name` | `callee(valor)` |
| `f(extra, args)` | `f(valor, extra, args)` |
| `target!(extra, args)` | `target!(valor, extra, args)` |

## 13. Organización de archivos y proyecto

### 13.1 Workspace de VS Code

El proyecto se organiza como una carpeta de VS Code. El explorador permite:

- crear una carpeta/proyecto y archivos `.placitum`,
- abrir archivos,
- renombrar,
- eliminar,
- seleccionar el archivo activo.

La extensión registra el lenguaje `.placitum`, aporta gramática, diagnósticos
y comandos. El árbol de archivos es el de VS Code; no se implementa un árbol
propio.

### 13.2 Archivo activo como punto de entrada

Cada archivo `.placitum` es ejecutable por sí mismo. El “punto de entrada” es
el archivo activo: `Placitum: Run file` guarda ese archivo y lo ejecuta con el
CLI bundleado. No hay un archivo `main` ni una validación de proyecto completo.

Esta decisión es coherente con un lenguaje de shell: cada script es una
unidad de ejecución. La exclusión del archivo principal se justifica en la
sección 20.2.

### 13.3 Importaciones: exclusión autorizada

El lenguaje no tiene `import`. La organización multiarchivo se cubre con el
workspace de VS Code, pero **no hay reutilización de funciones entre
archivos**. Esta es una exclusión de alcance autorizada por el docente; la
justificación completa y sus límites están en la sección 20.2.

## 14. Proceso de compilación y análisis

### 14.1 Pipeline

En Placitum, “compilar” significa analizar estáticamente el fuente. No se
genera código objeto: el lenguaje es interpretado.

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

### 14.2 Chequeos estáticos

- Lexer y parser tolerantes para reportar varios errores y recuperar el AST.
- Extractor: todo bang call con primer argumento literal debe estar cubierto
  por un grant (E301).
- Guard: canonicaliza rutas y compara contra el grant; cubre valores
  dinámicos.
- LSP: binder E500/E506, strict E505, chequeos literales E501–E504.
- Cascada controlada: un error léxico salta el parseo; un error de parseo salta
  la extracción.

### 14.3 Diagnósticos y estado

El LSP publica diagnósticos con rango UTF-16, código, mensaje y sugerencia. En
VS Code se ven en el panel Problems y en el editor. `Placitum: Reanalyze file`
fuerza el análisis.

No hay un botón “Compilar” separado porque el análisis es continuo y el
lenguaje es interpretado. El estado resumido se muestra en la barra de estado
(`OK`, errores o advertencias del archivo activo) y en el canal de salida
**Placitum — Analysis**; `Placitum: Show analysis status` lo abre. El comando
`Placitum: Reanalyze file` se mantiene sin cambios.

## 15. Proceso de ejecución

### 15.1 Pipeline de ejecución

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

### 15.2 Guard de capabilities

- Canonicaliza rutas (`..`, symlinks) antes de comparar.
- `fs.read`/`fs.write` usan globs; `net` usa host exacto o `*.dominio`.
- `env(NAME)` exige la variable al inicio; `env(NAME?)` es opcional.
- `exec` está reservado y se aplica en runtime, pero ningún builtin lo consume.
- Una ruta que hacía match textual pero canonicaliza fuera del grant es E403.

### 15.3 Builtins

| Builtin | Firma | Grant | Notas |
|---|---|---|---|
| `print!(value)` | `(any) -> null` | ninguno | Salida estándar |
| `eprint!(value)` | `(any) -> null` | ninguno | Salida de error |
| `json.parse(text)` | `(string) -> any` | ninguno | Puro; JSON inválido E501 |
| `fs.readFile!(path)` | `(string) -> string` | `fs.read(...)` | Lee un archivo |
| `fs.writeFile!(path, contents)` | `(string, string) -> null` | `fs.write(...)` | Escribe un archivo |
| `curl!(url[, opts])` | `(string[, object]) -> object` | `net(...)` | HTTP; rechaza redirects |

### 15.4 Errores de ejecución

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

## 16. Manejo de errores

### 16.1 Taxonomía

| Fase | Códigos |
|---|---|
| Lex | E101–E106 |
| Parse | E201–E206 |
| Extract | E301–E305 |
| Guard | E401–E406 |
| Eval | E500–E506 |
| CLI | E601–E603 |

### 16.2 Sobre de error

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

### 16.3 Errores y advertencias

- Todos los diagnósticos actuales son errores; el esquema admite `warning`,
  pero no hay emisores.
- No hay errores de importación porque no hay imports.
- Los resultados y el estado de ejecución se ven en la terminal; los
  diagnósticos, en VS Code.

## 17. Innovación

### 17.1 Idea

La innovación es el **modelo de capabilities del lenguaje**: la autoridad de un
script es un dato explícito, no una consecuencia implícita de ejecutarse como
el usuario. Se combina prueba estática, guard runtime, manifiesto y atenuación.

### 17.2 Implementación

| Componente | Función |
|---|---|
| `needs` | Declara los grants del script |
| Bang calls | Hacen visible todo efecto |
| Extractor | Prueba literales contra el manifiesto |
| Guard | Canonicaliza y autoriza valores dinámicos |
| `explain` | Muestra el manifiesto sin ejecutar |
| `needs only(...)` | Reduce la autoridad de una función |
| LSP/extensión | Diagnósticos, hover, quick fixes, manifiesto |

### 17.3 Validaciones

- Prueba estática de literales (E301).
- Guard de rutas canónicas, globs y hosts.
- Rechazo de symlinks de escritura y redirects HTTP.
- Pruebas de capability, guard y chokepoint.
- Pruebas de LSP para diagnósticos, quick fixes y manifiesto.

### 17.4 Demostración

Para la defensa:

1. Ejecutar `placitum explain examples/rosetta.placitum` y mostrar el manifiesto.
2. Quitar un grant y mostrar E301 antes de ejecutar.
3. Cambiar una ruta por una fuera del grant y mostrar E402/E403 en runtime.
4. Abrir el archivo en VS Code, mostrar diagnósticos y el quick fix “Add needs”.
5. Mostrar `needs only(...)` en una función y explicar la atenuación.

## 18. Arquitectura del aplicativo

### 18.1 Componentes

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

### 18.2 Flujo

1. El usuario edita un `.placitum` en VS Code.
2. La extensión envía `didChange` al LSP.
3. El LSP analiza con el barril del núcleo.
4. Los diagnósticos vuelven al editor.
5. `Placitum: Run file` guarda y ejecuta el CLI bundleado.
6. El CLI lexa, parsea, extrae, crea el guard y evalúa.

### 18.3 Límites de seguridad

- Solo `pl-lg/src/host-bindings` importa `fs`, `child_process`, red y OS.
- El evaluador y la stdlib no tienen I/O.
- `pl-lsp` nunca ejecuta código Placitum.
- La extensión no reimplementa análisis: solo muestra resultados y aplica
  `WorkspaceEdit`.
- El servidor y el CLI viajan bundleados en la extensión; no se requiere una
  instalación global.

### 18.4 Versiones

| Componente | Paquete | Versión |
|---|---|---|
| Núcleo | `placitum` | 1.0.1 |
| Servidor | `placitum-lsp` | 0.1.1 |
| Extensión | `placitum-vscode` | 0.1.3 |

El núcleo y el servidor tienen releases `1.0.1`/`0.1.1` preparadas en sus repos,
pero npm solo tiene publicadas `1.0.0`/`0.1.0`. La extensión `0.1.3` empaqueta
las versiones publicadas hasta que se publiquen las nuevas. Los tags finales
son `v1.0.1`, `v0.1.1` y `v0.1.3`.

## 19. Pruebas

### 19.1 Resumen de ejecución

| Componente | Comando | Resultado |
|---|---|---|
| `pl-lg` | `npm test` | 26 archivos, **207/207 tests pasan** |
| `pl-lg` | `npm run typecheck` + `npm run build` | OK |
| `pl-lsp` | `npm test` | 34 archivos pasan, 1 skip; **288/288 tests pasan, 4 skip** |
| `pl-lsp` | `npm run typecheck` + `npm run build` | OK |
| `pl-vscode` | `npm run test:guard` | 8/8 pasan (3 guards + 3 status + 2 reference) |
| `pl-vscode` | `smoke:server`, `smoke:cli`, `smoke:wrapper` | Los tres pasan |

### 19.2 Programas válidos

| # | Programa / objetivo | Entrada | Esperado = obtenido | Estado |
|---|---|---|---|---|
| 1 | `rosetta` — recorrer todo el lenguaje | Ninguna; usa archivo temporal | Golden `rosetta.eval.golden.json`; coincide | Pasa |
| 2 | `control-flow` — closures, pipes, ciclos y verdad | Ninguna | Golden `control-flow.eval.golden.json`; coincide | Pasa |
| 3 | `kitchen-sink` (parser) — cobertura sintáctica | Ninguna | Golden `kitchen-sink.ast.golden.json`; coincide | Pasa |
| 4 | `kitchen-sink` (capability) — manifiesto | Ninguna | Golden `kitchen-sink.manifest.golden.json`; coincide | Pasa |
| 5 | `rosetta` (parser) — ejemplo canónico | Ninguna | Golden `rosetta.ast.golden.json`; coincide | Pasa |

Archivos: `pl-lg/examples/rosetta.placitum`;
`pl-lg/tests/eval/control-flow.placitum`;
`pl-lg/tests/parser/kitchen-sink.placitum`;
`pl-lg/tests/capability/kitchen-sink.placitum`;
`pl-lg/tests/parser/rosetta.placitum`.

### 19.3 Errores sintácticos

| # | Fixture | Entrada | Esperado | Obtenido | Estado |
|---|---|---|---|---|---|
| 1 | `e101-unterminated-string` | `let s = "abc` | E101 | E101 | Pasa |
| 2 | `e104-bare-bang` | `let b = !x` | E104 | E104 | Pasa |
| 3 | `e201-missing-expr` | `let x =` | E201 | E201 | Pasa |
| 4 | `e203-unterminated-block` | `fn f() { let x = 1` | E203 | E203 | Pasa |
| 5 | `e206-duplicate-param` | `fn f(a, a) { }` | E206 | E206 | Pasa |

### 19.4 Errores semánticos

| # | Fixture | Entrada | Esperado | Obtenido | Estado |
|---|---|---|---|---|---|
| 1 | `e500-unbound-read` | `let copy = missing_name` | E500 | E500 | Pasa |
| 2 | `e501-type-mismatch` | `let s = 1 + "a"` | E501 | E501 | Pasa |
| 3 | `e503-arity-mismatch` | `fn f(a) { return a }` + `f(1, 2)` | E503 | E503 | Pasa |
| 4 | `e504-division-by-zero` | `let q = 1 / 0` | E504 | E504 | Pasa |
| 5 | `e506-let-redeclaration` | `let x = 1` + `let x = 2` | E506 | E506 | Pasa |

### 19.5 Importaciones

| Prueba | Estado | Motivo |
|---|---|---|
| Tres pruebas de importación | N/A | El lenguaje no tiene imports; exclusión autorizada (20.2) |
| Importación circular | N/A | No aplica sin imports |
| Errores en archivos importados | N/A | No aplica sin imports |

### 19.6 Caso de estudio completo

**Problema:** auditar el estado de tres servicios y generar un reporte.

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

needs fs.read("/home/usuario/proyecto/services.json"), fs.write("/home/usuario/proyecto/report.txt"), env(REPORT_MODE?)

fn classify(status) {
    if status >= 200 && status < 300 {
        return "ok"
    }
    if status >= 500 {
        return "critical"
    }
    return "warning"
}

let raw = fs.readFile!("/home/usuario/proyecto/services.json") | json.parse
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

fs.writeFile!("/home/usuario/proyecto/report.txt", f"total={total} ok={ok}")
print!(f"report written: {ok}/{total} ok")
```

> Las rutas absolutas deben reemplazarse por las del proyecto real. La
> verificación se ejecutó en un directorio temporal con las rutas
> correspondientes.

**Salida esperada y obtenida:**

```text
gateway: ok
billing: critical
search: warning
report written: 1/3 ok
```

**Archivo `report.txt`:**

```text
total=3 ok=1
```

**Estado:** pasa (verificación manual con el CLI; no forma parte de la suite
automatizada).

### 19.7 Cobertura y limitaciones

- Suite automatizada amplia: lexer, parser, capability, guard, eval, explain,
  CLI, LSP, protocolo y empaquetado.
- No se abrió VS Code de forma interactiva; se usaron smokes y lectura del
  código.
- El caso de estudio es manual; se recomienda incorporarlo como fixture.
- No hay pruebas de imports/circular por la exclusión autorizada.

## 20. Decisiones de alcance y exclusiones autorizadas

### 20.1 Criterio

El docente autorizó omitir el multiarchivo justificando que VS Code puede abrir
una carpeta con varios archivos y que esa es la IDE del proyecto. También
autorizó omitir otras especificaciones que no tengan sentido para este tipo de
lenguaje, **siempre que se justifiquen correctamente**.

La regla que se aplica en este documento es:

- **Excluido autorizado:** no se implementa porque el modelo del lenguaje o la
  IDE lo hacen innecesario, y existe una justificación técnica.
- **Parcial:** está implementado en parte; falta una mejora concreta.
- **No cumple:** es un requisito aplicable que no está cubierto.

### 20.2 Multiarchivo, importaciones y archivo principal

**Decisión:** se omite el sistema de importaciones y el archivo principal. El
proyecto se organiza como un workspace de VS Code con scripts independientes.

**Justificación:**

- Placitum es un lenguaje de shell. La unidad de ejecución y de seguridad es
  el archivo `.placitum`: cada script declara su propio `needs` y se ejecuta de
  forma independiente.
- Componer manifiestos de capabilities entre archivos introduciría ambigüedad
  sobre qué permisos hereda cada función y rompería el modelo “un script = un
  límite de capabilities”.
- VS Code cubre la organización multiarchivo: abrir carpeta, crear, abrir,
  renombrar, eliminar y seleccionar archivos.
- El archivo activo es el punto de entrada; `Placitum: Run file` lo guarda y lo
  ejecuta.

**Limitación:** no hay reutilización de funciones entre archivos. Las funciones
compartidas deben duplicarse o extraerse a un script invocable. **No es una
equivalencia funcional con imports**; es una exclusión de alcance autorizada.

**Texto para el docente:**

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

### 20.3 Entrada de datos por stdin

**Decisión:** no hay entrada interactiva por stdin.

**Justificación:** stdin sería un canal ambiental implícito, contrario al
modelo de capabilities. Toda entrada debe declararse en `needs` y llega por
`fs.readFile!`, `curl!` o la validación de `env(...)`. Esto hace que el origen
de los datos sea visible y auditable.

**Limitación:** no se pueden escribir programas interactivos que pregunten por
teclado. Para este proyecto, la entrada por archivo/red es suficiente.

### 20.4 Entero y flotante

**Decisión:** un solo tipo `number` (IEEE double).

**Justificación:** evitar overflow de enteros, coerciones implícitas y dos
conjuntos de operadores. Es la misma decisión de lenguajes de scripting como
Lua o JavaScript. Las restricciones (`/0` es E504) están documentadas.

**Limitación:** no hay operaciones exclusivas de enteros; todos los números son
doubles. Los tipos simples quedan en cuatro categorías (`string`, `number`,
`boolean`, `null`), con `number` cubriendo enteros y flotantes, más dos
compuestos (`array`, `object`).

### 20.5 Botón de compilación e IDE propio

**Decisión:** no hay botón “Compilar” separado ni IDE propio.

**Justificación:** el análisis es continuo a través del LSP (lexer, parser,
extractor, binder y chequeos estáticos). VS Code es la IDE; `Placitum:
Reanalyze file` fuerza el análisis. El lenguaje es interpretado y no genera
código objeto, por lo que no hay una fase de compilación separada.

**Estado implementado:** la barra de estado muestra `OK`, errores o
advertencias del archivo activo, y `Placitum: Show analysis status` abre el
canal **Placitum — Analysis** con el detalle. El comando de análisis existente
(`Reanalyze file`) se mantiene.

### 20.6 Warnings y errores de importación

**Decisión:** no se emiten warnings y no hay errores de importación.

**Justificación:** no hay imports, así que los errores de importación son N/A.
El lenguaje no define warnings; todos los diagnósticos actuales son errores.
El esquema admite `warning` si se agregan en el futuro.

**Limitación:** la salida no muestra advertencias. Para el alcance actual, los
errores cubren los casos relevantes.

### 20.7 Lo que no se excluye

No se consideran justificables las siguientes omisiones; siguen siendo
entregables:

- Documentación del proyecto en PDF.
- Planteamiento del problema y evidencias de investigación.
- Logotipo e identidad.
- Tabla de palabras reservadas.
- Informe de pruebas con objetivo/entrada/esperado/obtenido/estado.
- Manual de usuario y presentación.

El **menú de referencia**, el **estado resumido de análisis** y los **tags
locales** (`v1.0.1`, `v0.1.1`, `v0.1.3`) ya están implementados; no forman
parte de las exclusiones.

## 21. Contribuciones de los integrantes

| Integrante | Evidencia en Git | Contribución principal |
|---|---|---|
| Matteo Vargas | ~26 commits en `pl-lg` | Núcleo del lenguaje: lexer, parser, extractor, guard, evaluador, CLI, pruebas y documentación |
| Aryel Rivera | ~15 commits en `pl-lg`, ~20 en `pl-lsp` | Servidor LSP: análisis, features, compatibilidad, pruebas de protocolo |
| Kristel Montoya | ~3 en `pl-lg`, ~7 en `pl-lsp`, ~35 en `pl-vscode` | Extensión de VS Code, integración, empaquetado, publicación y documentación |

Los tres nombres figuran en `AUTHORS` de los tres repositorios. La colaboración
técnica es visible en commits que tocan `src`, `tests` y documentación. La
participación en la presentación/defensa no es verificable desde el
repositorio; debe evidenciarse en la defensa individual.

## 22. Conclusiones

Placitum cumple el núcleo del proyecto: un lenguaje con sintaxis, semántica,
tipos, funciones, control de flujo, operadores, ejecución y una innovación
técnica real (capabilities con verificación estática y runtime). La extensión
de VS Code cubre el entorno gráfico y el servidor LSP aporta la experiencia de
editor.

Con la autorización del docente, el multiarchivo/imports/main se presenta como
una exclusión de alcance justificada, no como un fallo. La justificación se
apoya en el modelo de seguridad del lenguaje y en el workspace de VS Code, y
reconoce su límite: no hay reutilización de funciones entre archivos.

Los tags locales `v1.0.1`, `v0.1.1` y `v0.1.3` ya están creados; falta
pushearlos y abrir/mergear los PR. Quedan tareas de entrega: el proyecto de
ejemplo en carpeta, el manual de usuario y la presentación. El núcleo técnico y
las pruebas están en buen estado; el riesgo principal está en la publicación de
npm (`placitum@1.0.1` / `placitum-lsp@0.1.1`) y en la justificación de las
exclusiones.

## 23. Referencias

1. Saltzer, J. H., & Schroeder, M. D. (1975). The Protection of Information in
   Computer Systems. *Proceedings of the IEEE*, 63(9), 1278–1308.
   https://doi.org/10.1109/PROC.1975.9939
2. Dennis, J. B., & Van Horn, E. C. (1966). Programming Semantics for
   Multiprogrammed Computations. *Communications of the ACM*, 9(3), 143–155.
   https://doi.org/10.1145/365230.365252
3. Miller, M. S. (2006). *Robust Composition: Towards a Unified Approach to
   Access Control and Concurrency Control*. Tesis doctoral, Johns Hopkins
   University.
4. Watson, R. N. M., Anderson, J., Laurie, B., & Kennaway, K. (2012). Capsicum:
   Practical Capabilities for UNIX. *USENIX Security Symposium*.
   https://www.usenix.org/conference/usenixsecurity12/technical-sessions/presentation/watson
5. NIST. *Security and Privacy Controls for Information Systems and
   Organizations* (SP 800-53 Rev. 5), control AC-6, Least Privilege.
   https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
6. Visual Studio Code. *Language Server Extension Guide*.
   https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
7. Visual Studio Code. *Extension Manifest*.
   https://code.visualstudio.com/api/references/extension-manifest
8. GNU. *Bash Reference Manual*.
   https://www.gnu.org/software/bash/manual/

## 24. Anexos

### A. Glosario

- **Capability:** autoridad explícita para realizar un efecto.
- **Bang call:** llamada con `!` a un builtin con efecto.
- **Grant:** permiso declarado en `needs`.
- **Manifiesto:** representación serializada de los grants y verificaciones.
- **Guard:** componente que autoriza en runtime.
- **Atenuación:** reducción de autoridad con `needs only(...)`.
- **LSP:** Language Server Protocol.

### B. Comandos útiles

```bash
# Núcleo
cd pl-lg
nix develop --command npm ci
nix develop --command npm test
nix develop --command npm run typecheck
nix develop --command npm run build
nix develop --command node dist/cli/bin.js run examples/rosetta.placitum
nix develop --command node dist/cli/bin.js explain examples/rosetta.placitum

# LSP
cd ../pl-lsp
nix develop --command npm test

# Extensión
cd ../pl-vscode
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
