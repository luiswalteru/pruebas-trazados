# Utilidades - Documentacion Tecnica

> **Importante (abril 2026)**: La app es manual-only. Las utilidades "core" del flujo actual son `letterMask.js`, `svgGenerator.js`, `thumGenerator.js`, `dataGenerator.js` y `exportUtils.js`. `fontParser.js` solo se usa para la fuente de referencia opcional (guia visual). **`pathSampler.js` ya no se importa en ninguna parte** — es codigo legacy conservado en el repo.

---

## letterMask.js (NUEVO)

Rasteriza el `letter-fill.svg` a una mascara binaria y precomputa una **transformada de distancia (chamfer 3-4)** para poder tirar puntos dibujados hacia el eje medial (esqueleto) de la letra de forma estable e independiente de la direccion.

Usado por `ManualPathDrawer` para suavizar el trazado del usuario.

### Funciones exportadas

#### `async buildLetterMask(fillSvgContent, width, height)`
Construye la mascara y el campo de distancia.
- **Input**: string del SVG fill, dimensiones
- **Output**: `{ mask: Uint8Array, dist: Float32Array, width, height }` o `null` si falta algun input
- **Proceso**: carga el SVG como imagen -> dibuja en canvas -> convierte a mascara binaria (`alpha > 32 = 1`) -> calcula distance transform (chamfer 3-4) con dos pasadas (forward + backward)

#### `snapToCenterline(point, maskInfo, opts = {})`
Empuja suavemente un punto hacia el eje medial de la letra usando el **gradiente del campo de distancia** (que dentro de la forma apunta hacia el esqueleto — magnitud ~0 en el centro).

- **Input**:
  - `point`: `{ x, y }` ya pasado por smoothing de entrada
  - `maskInfo`: resultado de `buildLetterMask`, o `null` para no-op
  - `opts.pullStrength` (default 1.2)
  - `opts.maxStep` (default 2 px)
  - `opts.pullRadius` (default 40) — radio maximo para buscar el pixel interior mas cercano si el punto cae fuera
- **Output**: `{ x, y }` corregido

**Ventaja sobre un pull direccional**: al usar el gradiente del distance field, la correccion es siempre radial hacia el esqueleto y se atenua a cero cuando el punto ya esta centrado. No depende de la direccion del movimiento del usuario (que es ruidosa).

Si `maskInfo === null` o si el punto esta muy cerca del esqueleto (`gmag < 0.15`), retorna el punto sin cambios. Si el punto cae fuera de la letra, primero busca en espiral el interior mas cercano (dentro de `pullRadius`) y opera desde ahi.

---

## svgGenerator.js

Genera los SVGs del bundle. Incluye dos caminos: con fuente de referencia (generadores "normales") y sin ella (generadores "FromStrokes" como fallback).

### Funciones exportadas

#### `generateFillSvg(pathD, width, height)`
Fill SVG a partir de un path del glifo de la fuente de referencia.
- Path con `id="fill"` y `style="fill-rule:nonzero;"`

#### `generateFillSvgFromStrokes(strokePaths, width, height, strokeWidth = 40)` (NUEVO)
Fill SVG fallback cuando no hay fuente. Dibuja cada stroke del usuario como un path engrosado (no relleno real, sino stroke grueso) para aproximar la silueta.
- Cada path con `id="fill1"`, `id="fill2"`, ...

#### `generateOutlineSvg(pathD, width, height, strokeWidth = 3)`
Outline SVG a partir del path de la fuente de referencia.
- Path con `id="contorno"` sin fill

#### `generateOutlineSvgFromStrokes(strokePaths, width, height, borderWidth = 3)` (NUEVO)
Outline fallback. Cada stroke como path fino.
- Cada path con `id="contorno1"`, `id="contorno2"`, ...

#### `generateDottedSvg(strokePaths, width, height, strokeWidth = 8)`
Emite un `<path id="path{i+1}">` dasheado por cada trazo, envueltos en un `<g id="path">`. Es el formato historico que espera el componente consumidor.

- **Input**: `strokePaths: Array<{ id?, d }>` (producido por `ManualPathDrawer.handleFinalize`: `smooth(pts, 2)` → `M x,y L x,y ...`)
- **Output**: string SVG. `<g><g><g id="path">` envolviendo `<path id="path1" d="..." style="fill:none;stroke:#ccc;stroke-width:{N}px;stroke-linecap:round;stroke-dasharray:0.1,16;"/>` por trazo.
- `strokeWidth` tipicamente se pasa como el `animationPathStroke` efectivo para que el grosor del trazo animado coincida con el estilo punteado.

Los ids `path1`, `path2`, ... concuerdan con los selectores de `letterAnimationPath` en el `data.json`.

---

## thumGenerator.js (NUEVO)

Rasteriza el fill de la letra + los puntos del trazado a una PNG (`thum.png`), que se empaqueta automaticamente en el ZIP exportado.

### Funciones exportadas

#### `async generateThumPngBlob({ fillPathD, strokePaths, dotList, width, height, dotRadius, fallbackStrokeWidth })`
- **Input**:
  - `fillPathD`: path `"d"` del glifo de la fuente de referencia (si hay)
  - `strokePaths`: fallback cuando no hay `fillPathD` — se engruesan (`fallbackStrokeWidth`, default 40) para formar silueta
  - `dotList`: lista de trazos, se dibuja un circulo magenta (`#e91e63`) en cada `coords`
  - `width`, `height`: tamaño de salida (typicamente `letterSize` del data.json)
  - `dotRadius`: radio de los circulos (default 6)
- **Output**: `Blob` PNG

**Proceso**: construye un SVG en memoria con fill + circles -> lo carga en un `<img>` -> dibuja en un `<canvas>` del tamaño objetivo -> exporta a blob PNG via `canvas.toBlob`.

---

## dataGenerator.js

Genera el `data.json`, maneja nomenclatura y computa valores por letra.

### Funciones exportadas

#### `generateDataJson({ letter, type, letterSize, dotList, animationPaths, animationPathStroke, dotSize })`
Construye el objeto `data.json` completo.

**Logica del campo `letter`**:
- Ligada: `letter.toLowerCase()` -> `"a"`, `"ch"`, `"ll"`, `"ñ"` (sin mapeo a `"ny"`)
- Mayusculas: `"Upper" + Capitalized` -> `"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"`

**Calculo de `time` en animationPaths**:
- Si el caller provee `p.time`, se usa tal cual
- Fallback: `Math.max(2, Math.round(p.length / 50))`
- `GeneratorPage.generateForLetter` actualmente pasa `time = Math.max(2, Math.round(coordinates.length / 4))`

#### `getFolderName(letter, type)`
Nombre de carpeta.
- Mapeo especial: `ñ` -> `ny`; `ch` y `ll` se mantienen
- Ligada: `trazado-letra-{base}`
- Mayusculas: `trazado-letra-{base}-mayus`

#### `computeLetterParams(letter, type, canvasW)`
Computa `dotSize` y `animationPathStroke` para una letra.

- **Input**: letra, tipo, ancho del canvas
- **Output**: `{ dotSize: number, animationPathStroke: number }`
- **Logica mayusculas**: `dotSize` = 34 (40 si `canvasW > 240`), `stroke` = 10 (12 si `canvasW > 350`)
- **Logica ligada**: ramas por `canvasW` (26-38) + overrides especificos para `e`, `i`, `k`, `m`, `n`, `u`, `p`

#### `computeDotCount(pathLengthPx)`
Cantidad recomendada de puntos para un trazo segun su longitud.
- **Formula**: `round(pathLengthPx / 6.5)`, clamped a `[3, 90]`
- **Nota**: expuesto pero **no se llama desde la UI actual** (el modo manual usa el `dotCount` que el usuario configura, igual para todos los trazos)

### Constantes exportadas

- `SPANISH_LETTERS`: 27 letras (a-z + ñ)
- `SPECIAL_COMBOS`: `['ch', 'll']`

---

## exportUtils.js (REFACTORIZADO)

Exportacion de trazados como ZIP. Ahora **async** (porque genera `thum.png` rasterizando en `<canvas>`).

### Dependencias
- `JSZip` - generacion de ZIP
- `file-saver` - descarga del blob
- `thumGenerator` - genera `thum.png`

### Funciones exportadas

#### `async downloadSingleTrazado(trazado)`
Crea un ZIP con una sola letra y lo descarga como `{folderName}.zip`.

#### `async exportAllTrazados(trazadosList, baseType)`
Exporta multiples trazados en un solo ZIP agrupados bajo `ligada/` o `mayusculas/`. Descarga como `trazados-{baseType}.zip`.

### Helper interno `writeTrazadoFiles(folder, trazado)`
Escribe en el folder de JSZip:
1. `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `data.json`
2. `thum.png` generado por `generateThumPngBlob`, con:
   - `width`, `height` = `data.json.letterSize` (default `[380, 340]`)
   - `dotRadius` = `max(4, round(dotSize / 4))`

**Ya no escribe**: `character.png`, `fondo.png`, `audio/es/title.mp3`, `audio/val/title.mp3`. Tampoco hay placeholders silent-MP3 / 1×1-PNG.

`exportTrazado` (que antes retornaba `{ zip, folder }`) fue eliminado.

---

## fontParser.js (SOLO PARA GUIA VISUAL)

Parsea fuentes tipograficas y extrae glifos como paths SVG. **Ya no es parte del flujo de generacion** — solo se usa cuando el usuario carga una fuente de referencia opcional en el paso 1, para:

1. Mostrar la forma de la letra bajo el canvas de `ManualPathDrawer` (opacity 8% + 20%)
2. Generar `letter-fill.svg` y `letter-outline.svg` en el export (en lugar de los fallbacks `FromStrokes`)
3. Construir la mascara de distancia via `buildLetterMask` para el auto-centrado del cursor

### Funciones exportadas

- **`parseFont(arrayBuffer)`**: parsea TTF/OTF/WOFF via opentype.js
- **`glyphToSvgPathData(font, char, targetWidth, targetHeight, padding)`**: extrae un glifo y lo escala/centra al canvas objetivo. Retorna `{ d, width, height, scale, offsetX, offsetY, bbox }`
- **`computeGlyphCanvasSize(font, char, type, padding)`**: computa dimensiones "naturales" del canvas. **Ya no se usa** en el flujo actual (el tamaño de canvas viene siempre del usuario). Conservado por si se reintroduce el modo font.
- **`getAvailableChars(font)`**: lista caracteres disponibles (tampoco se usa en la UI actual)

---

## pathSampler.js (LEGACY — no importado)

Modulo de esqueletonizacion / muestreo de puntos heredado del antiguo modo `font`/`svg`. **No lo importa ningun archivo de la app actual** — el modo manual usa un `resample` + `smooth` propios dentro de `ManualPathDrawer.jsx`.

Se conserva en el repo por dos razones:
1. Referencia para re-introducir generacion automatica desde fuente en el futuro.
2. El algoritmo (Zhang-Suen thinning + junction detection + merge colineal + smoothing + resample) esta bien documentado y es dificil de reconstruir desde cero.

Si se decide depurar el repo, este archivo puede eliminarse sin romper nada.

Funciones que exporta (todas actualmente muertas):
- `samplePathPoints`, `samplePathPointsMultiStroke` — muestreo
- `extractSkeletonSegments` — extrae segmentos + longitudes
- `generateCenterlinePaths` — paths SVG de linea central con curvas Bezier
- `extractPathsFromSvg` — parser de paths + viewBox desde un string SVG

Constantes: `RASTER_SCALE = 2`, `MIN_SEGMENT_RATIO = 0.08`.
