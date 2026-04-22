# Formatos de Datos - Schemas y Estructuras

## data.json

Archivo principal que describe el trazado de una letra. Estructura completa generada por `generateDataJson` en `src/utils/dataGenerator.js`:

```json
{
  "activityId": "trazados",
  "sectionId": "trazados",
  "title": {
    "es": "Trazado de la letra «a».",
    "val": "Trazado de la letra «a».",
    "audio": {
      "es": "audio/es/title",
      "val": "audio/val/title"
    }
  },
  "character": "character.png",
  "letterFill": "letter-fill.svg",
  "letterOutline": "letter-outline.svg",
  "letterDotted": "letter-dotted.svg",
  "letter": "a",
  "letterSize": [380, 340],       // Lo que haya configurado el usuario en Step 3
  "animationPathStroke": 16,      // Auto via computeLetterParams(..., canvasW) o forzado por el usuario
  "letterAnimationPath": [
    { "selector": "#path1", "time": 10 },
    { "selector": "#path2", "time": 8 }
  ],
  "dotSize": 33,                  // Auto via computeLetterParams(..., canvasW) o forzado por el usuario
  "playButtonPosition": [-20, 30],
  "dotList": [
    {
      "dragger": [190, 85],
      "coordinates": [
        { "coords": [190.000, 85.000] },
        { "coords": [185.123, 90.456], "corner": true },
        { "coords": [180.789, 95.012] }
      ]
    }
  ]
}
```

### Advertencia sobre campos huerfanos

Los campos `character` y `title.audio.{es,val}` siguen emitiendose tal cual, pero **desde el refactor manual-only estos archivos ya no se incluyen en el ZIP exportado**. Solo se empaquetan `data.json`, los tres SVGs y `thum.png`. Si el componente consumidor los necesita, hay que proveerlos aparte o dejar de escribir estos campos en `generateDataJson`.

### Campos clave

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `letter` | string | Identificador. Ligada: `"a"`, `"b"`, `"ch"`, `"ll"`, `"ñ"`. Mayusculas: `"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"` (see nota abajo) |
| `letterSize` | `[width, height]` | Dimensiones del canvas. Siempre el valor configurado por el usuario en Step 3 (default 380×340) — ya no hay auto-compute por letra |
| `animationPathStroke` | number | Grosor del trazo de animacion. Auto: ligada 10–18, mayusculas 10–12 via `computeLetterParams`. O forzado por el usuario |
| `letterAnimationPath` | array | Selectores CSS para paths del SVG dotted y tiempo de animacion |
| `dotSize` | number | Tamano visual de cada punto. Auto: ligada 26–40, mayusculas 34–40 via `computeLetterParams`. O forzado por el usuario |
| `playButtonPosition` | `[x, y]` | Posicion relativa del boton play — constante `[-20, 30]` |
| `dotList` | array | Array de trazos. Cada trazo tiene `dragger` y `coordinates` |

### Nota sobre el campo `letter` (ñ)

`dataGenerator.generateDataJson` construye el campo `letter` usando el valor crudo: para ñ lowercase queda literalmente `"ñ"`, y para mayusculas queda `"UpperÑ"`. El nombre de carpeta, en cambio, mapea ñ → `ny` via `getFolderName`. Si el componente consumidor espera `"ny"` / `"UpperNy"` en el campo `letter` (como implica el formato de carpeta), hay un desajuste a revisar.

### dotList - Detalle

Cada elemento del array `dotList` representa un trazo (stroke) del trazado:

```json
{
  "dragger": [x, y],
  "coordinates": [
    { "coords": [x, y] },
    { "coords": [x, y], "corner": true },
    ...
  ]
}
```

- **`dragger`**: Coordenadas enteras `[x, y]` del punto de inicio del trazo (primer punto redondeado via `toFixed(0)`)
- **`coordinates`**: Array de puntos que forman el recorrido del trazo
  - `coords`: Array `[x, y]` con 3 decimales, en espacio de letra (px del canvas)
  - `corner` (opcional): `true` si el punto es una esquina/cambio de direccion (angulo > 45°)

### Generacion del dotList (modo manual)

`ManualPathDrawer.handleFinalize` construye el dotList asi:

1. Toma los trazos dibujados (arrays crudos de `{x, y}` ya filtrados por distancia minima y suavizados por EMA + `snapToCenterline`)
2. Por cada trazo: `resample` a `dotCount` puntos equidistantes
3. Aplica `toFixed(3)` a cada `coords`
4. Marca esquinas con `corner: true` (diferencia de angulo entrada/salida > π/4)
5. Extrae `dragger` del primer punto resampleado via `toFixed(0)`

### Multi-stroke (letras con varios trazos)

Letras como "A" mayuscula tienen multiples trazos. El usuario dibuja cada uno por separado (mouse-down/up inicia y termina cada trazo; tecla `N` fuerza el fin). El array `dotList` tendra un elemento por trazo:

```json
{
  "dotList": [
    { "dragger": [190, 40], "coordinates": [...] },
    { "dragger": [100, 270], "coordinates": [...] }
  ],
  "letterAnimationPath": [
    { "selector": "#path1", "time": 10 },
    { "selector": "#path2", "time": 5 }
  ]
}
```

El indice de cada `dotList[i]` corresponde al selector `#path{i+1}` en `letterAnimationPath`.

El campo `time` lo calcula `GeneratorPage.generateForLetter` como `Math.max(2, Math.round(coordinates.length / 4))` y lo pasa a `generateDataJson`, que prioriza `p.time` si viene (caida a `Math.max(2, round(length / 50))` si no).

---

## SVG Files

### letter-fill.svg

SVG con la letra completamente rellena. Se usa como feedback visual cuando el usuario completa el trazado.

- Si hay fuente de referencia: generado con `generateFillSvg(pathD, w, h)` — un unico `<path id="fill">` con el glifo.
- Si **no** hay fuente: generado con `generateFillSvgFromStrokes(strokePaths, w, h, strokeWidth)` — un `<path id="fillN">` por trazo del usuario, dibujado como linea engrosada (fallback — silueta aproximada).

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "...">
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><path id="fill" d="M..." style="fill-rule:nonzero;"/></g></g>
</svg>
```

**Importante**: Cuando hay fuente, el path tiene `id="fill"`. En el fallback los ids son `fill1`, `fill2`, ...

### letter-outline.svg

SVG con el contorno de la letra, **interior blanco**. Misma silueta que `letter-fill.svg` pero hueca: se ve un borde negro alrededor del cuerpo y el interior es blanco, para que no tape la guia punteada ni la animacion de trazado.

- Con fuente: `generateOutlineSvg` — un unico `<path id="contorno">`.
- Sin fuente: `generateOutlineSvgFromStrokes` — para cada trazo, dos paths stacked sobre el mismo `d`: uno negro con `stroke-width = fillStrokeWidth` (`id="contornoN"`) y otro blanco con `stroke-width = fillStrokeWidth − 2·borderWidth` (sin id). Primero todos los negros, luego todos los blancos, para que el solape entre trazos (p.ej. bucle + cola de una "a") no deje costura interna.

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g>
    <path id="contorno1" d="M..." style="fill:none;stroke:#000;stroke-width:40px;stroke-linecap:round;stroke-linejoin:round;"/>
    <path id="contorno2" d="M..." style="fill:none;stroke:#000;stroke-width:40px;stroke-linecap:round;stroke-linejoin:round;"/>
    <path d="M..." style="fill:none;stroke:#fff;stroke-width:34px;stroke-linecap:round;stroke-linejoin:round;"/>
    <path d="M..." style="fill:none;stroke:#fff;stroke-width:34px;stroke-linecap:round;stroke-linejoin:round;"/>
  </g></g>
</svg>
```

### letter-dotted.svg

Un `<path>` con `stroke-dasharray` por trazo, envuelto en `<g id="path">`. Emite **rayas (lineas dashed), no puntos**, para reproducir el visual del bundle de referencia `ejemplo/trazado-letra-a/letter-dotted.svg` (capsulas de ~12×5 px orientadas a lo largo del trazo, periodo 18 px).

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><g id="path">
    <path id="path1" d="M190,85L185.12,90.45L..."
      style="fill:none;stroke:#ccc;stroke-width:5px;stroke-linecap:round;stroke-dasharray:7,11;"/>
    <path id="path2" d="M100,270L..."
      style="fill:none;stroke:#ccc;stroke-width:5px;stroke-linecap:round;stroke-dasharray:7,11;"/>
  </g></g></g>
</svg>
```

**Contrato con el componente consumidor**:
- Un `<path id="path{i+1}">` por trazo, dentro del wrapper `<g id="path">`.
- `d` viene de `strokePaths[i].d` (construido por `ManualPathDrawer.handleFinalize` como `M x,y L x,y ...` sobre los puntos suavizados con `smooth(_, 2)`, antes del resample).
- Los selectores en `letterAnimationPath` (`#path1`, `#path2`, ...) apuntan a los `<path>` individuales.

**Parametros del dashing** (por defecto en `generateDottedSvg`, configurables via 4º/5º argumento):
- `stroke-width: 5px` — espesor de la raya, match con la altura del capsule en el bundle de referencia
- `stroke-dasharray: 7,11` — dash 7 + gap 11 en numeros raw. Con `stroke-linecap: round` y `stroke-width: 5`, los caps redondeados extienden el dash visible: `visible_dash = 7 + 5 = 12`, `visible_gap = 11 - 5 = 6`. Periodo total 18, que coincide con el del bundle de referencia.
- `stroke: #ccc` — gris claro
- `stroke-linecap: round` — caps redondeados que forman las capsulas

> **Nota**: el bundle `ejemplo/trazado-letra-a/letter-dotted.svg` alcanza el mismo visual con **paths rellenos** (18 sub-shapes cerrados por trazo con `fill:#cecece`) en lugar de dashing. Nuestro generador produce un SVG mas compacto via `stroke-dasharray` con el mismo aspecto final (el componente consumidor renderiza igual ambos, porque el dashing de SVG es equivalente en pantalla a esas capsulas cerradas).

### base.svg

Template SVG que replica la estructura de los componentes `LetterX` en `ejemplo/letters.js`. Lo consume el reader: hace `fetch` del archivo como texto y lo inyecta en un `<div style={{height:340}}>` via `dangerouslySetInnerHTML`, luego anima los `<path>` con `stroke-dasharray` + `stroke-dashoffset`; `#circle` es el marcador arrastrable del punto inicial; `#letterBg` el fondo clickable.

```xml
<svg class="svg-letter" width="100%" height="100%" viewBox="0 0 380 340">
  <rect id="letterBg" x="0" y="0" width="380" height="340"/>
  <path id="path1" class="svgPath" stroke-width="33" fill="none" d="M..."/>
  <path id="path2" class="svgPath" stroke-width="33" fill="none" d="M..."/>
  <circle id="circle" cx="190" cy="85" r="24"/>
</svg>
```

**Contrato**:
- **Sin XML prolog ni DOCTYPE.** El reader hace `innerHTML` de este fichero dentro de un `<div>` — un `<?xml ... ?>` o DOCTYPE externo dentro de un `<div>` es HTML invalido: el parser los convierte en comentario bogus y las reglas CSS (`.svg-letter .svgPath`) no aplican, dejando los paths con `fill:black` por defecto (la letra sale en negro). Se emite el mismo shape bare `<svg>` que React renderiza desde `letters.js`.
- Un `<path id="path{i+1}" class="svgPath" stroke-width="S" fill="none">` por trazo del usuario. `d` es el mismo `strokePaths[i].d` que usan `letter-dotted.svg` y `letter-fill.svg` (suavizado con `smooth(_, 2)`).
- `stroke-width="S"` se embebe como numero concreto (`effStroke` = `animationPathStroke` de `data.json`). En los componentes JSX de `letters.js` este valor llega por prop `stroke`; aqui esta baked-in para que el archivo se pueda servir estatico.
- `fill="none"` inline como **fallback de atributo de presentacion**: la regla CSS del reader (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`) tiene mayor especificidad y sobreescribe, pero si por el motivo que sea no carga, el `fill="none"` inline evita que el path se rellene en negro.
- `<circle id="circle" cx cy r>` en el **primer punto del primer trazo** (matching el cx/cy manual de los JSX). `r = Math.ceil(stroke / 1.4)` — misma formula que usan los componentes.
- Atributos estaticos, no JSX: `class` (no `className`), `stroke-width` (no `strokeWidth`).

### Formato SVG comun

Todos los SVGs comparten:
- DOCTYPE SVG 1.1
- `width="100%" height="100%"`
- `viewBox="0 0 {width} {height}"` donde width/height coinciden con `letterSize`
- Namespace SVG y xlink

---

## thum.png

Generado automaticamente por `generateThumPngBlob` en `src/utils/thumGenerator.js` al exportar. Es la **composicion de `letter-fill.svg` + `letter-dotted.svg`**: la letra rellena en negro con las rayas dasheadas gris claro superpuestas (efecto "carretera con linea central", igual que el `thum.png` de referencia en `ejemplo/trazado-letra-a/`).

Proceso: rasteriza `fillSvg` en un `<canvas>` como capa base, luego dibuja `dottedSvg` encima. Exporta a PNG via `canvas.toBlob`. Tamaño en pixeles = `letterSize` del `data.json`.

---

## Estructura de Carpetas de Exportacion

### Individual (ZIP de una letra)

```
trazado-letra-a.zip
  trazado-letra-a/
    data.json
    letter-fill.svg
    letter-outline.svg
    letter-dotted.svg
    base.svg
    thum.png
```

### Masiva (ZIP de todas las letras)

```
trazados-ligada.zip          (o trazados-mayusculas.zip)
  ligada/                    (o mayusculas/)
    trazado-letra-a/
      data.json
      letter-fill.svg
      letter-outline.svg
      letter-dotted.svg
      base.svg
      thum.png
    trazado-letra-b/
      ...
```

### Archivos que **ya no se exportan**

Desde el refactor manual-only:
- `character.png`
- `fondo.png`
- `audio/es/title.mp3`
- `audio/val/title.mp3`

Y por tanto tampoco hay placeholders (MP3 silencioso, PNG transparente) que antes los cubrian. Si la app consumidora los necesita, habra que proveerlos fuera del pipeline del generador.
