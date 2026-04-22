# Utilidades - Documentacion Tecnica

> **Importante (abril 2026)**: La app es dibujo manual con proyeccion al soltar. Las utilidades "core" del flujo actual son `guideExtractor.js` (extraccion de la linea guia + proyeccion), `letterMask.js` (fallback raster), `svgGenerator.js`, `thumGenerator.js`, `dataGenerator.js` y `exportUtils.js`. **`fontParser.js` y `pathSampler.js` no se importan en ningun lado** — son legacy conservados en el repo.

---

## guideExtractor.js (CORE)

Extrae la linea guia desde una imagen SVG con escena completa (letra + punteado + personaje), y proyecta los trazos dibujados sobre esa linea. Es el corazon del ajuste al soltar el trazo.

Pipeline:

1. **Rasterizado aspect-fit** del SVG a 2× canvas (para que los puntos guia pequeños sobrevivan el thresholding).
2. **Binarizado** de pixeles "tinta": luminancia < 90 **y** saturacion < 0.28 — filtra los colores vivos del personaje y deja solo letra + puntos guia en tonos oscuros.
3. **Connected components** con flood-fill 8-way. Cada blob registra area, pixeles, bounding box y centroide.
4. **Filtrado**: descarta los 3 blobs mas grandes (letra + silueta del personaje + sombras grandes) y cualquiera que exceda el 15% del mayor. Los blobs restantes son los **puntos del punteado**.
5. **Construccion de polilinea**: edges K=2 vecinos mas cercanos, con corte de distancia a ~2.5× la mediana de distancia-al-vecino — evita edges que crucen entre trazos separados.
6. **Endpoints**: vertices con grado 1 en el grafo de edges. Sirven para desambiguar el inicio/fin del trazo.

### Funciones exportadas

#### `async extractGuideMaskFromImage(imageSrc, width, height, opts = {})`
Ejecuta el pipeline completo y devuelve:
```
{
  mask: Uint8Array,       // mascara dilatada de los puntos guia (width * height)
  dist: Float32Array,     // distance transform chamfer 3-4 de esa mascara
  width, height,
  centroids: [{x,y,area}],
  edges: [{a,b}],         // indices en centroids[]
  endpoints: [i, j, ...], // indices en centroids[] con grado 1
  debug: { dotCount, centroids, edges, endpoints }
}
```
Retorna `null` si no sobrevive ningun blob.

Opciones relevantes: `darkLum` (default 90), `maxSat` (0.28), `discardLargest` (3), `minDotArea` (3), `maxDotFraction` (0.15), `renderScale` (2).

#### `isSvgSource(src)`
Sniff rapido de si una url/dataURL es SVG (`data:image/svg+xml` o extension `.svg`). Usado por `ManualPathDrawer` para decidir si llamar al extractor o al fallback raster.

#### `snapToPolyline(point, centroids, edges, opts = {})`
Proyecta un punto al **segmento mas cercano** de la polilinea, con sesgo direccional para no saltar a un tramo topologicamente lejano.

Modos de sesgo:
- Con `rawHistory` (recomendado, path crudo del cursor): calcula la tangente acumulando arco hacia atras hasta `dirLookback = 15px`, descompone `(proj - prev)` en `forward` (a favor de la tangente) y `lateral` (perpendicular), y suma al score `lateralBias * lateral² + backwardPenalty * max(0, -forward)²`. Por defecto `lateralBias = 2.5`, `backwardPenalty = 0.4`.
- Solo con `history` (proyectado): si no viene `rawHistory`, usa la historia proyectada para la tangente. Menos robusto porque una proyeccion errada contamina la dirección.
- Sin ninguna: fallback a `continuityBias * |proj - prev|²` (default 0.3).

`maxDist` (default 80 px) descarta proyecciones demasiado lejanas al cursor — si todas superan el radio devuelve el punto sin cambios.

#### `snapToEndpoint(point, centroids, endpoints, opts = {})`
Devuelve el endpoint (centroide de grado 1) mas cercano al punto, si esta dentro de `maxDist` (default 40). Si no hay ninguno cerca devuelve `null`.

Usada al proyectar el primer y ultimo punto de un trazo para que aterricen limpios en los extremos de la guia.

#### `projectStrokeOnGuide(points, guide, opts = {})`
Orquesta la proyeccion de un trazo completo:

1. Primer punto: snap al extremo de `segments` mas cercano (radio `endpointRadius` = 20) o proyeccion libre. El snap usa `guide.segmentEndpoints` — los extremos de los segmentos visibles (guia punteada) — no la lista cruda de pixels degree-1 del esqueleto, que incluye roturas de ciclos y vecinos de junction que no son visibles y provocan teletransportes cross-letra (p.ej. el final del bucle de una "a" cursiva saltando a la punta de la cola).
2. Cada punto siguiente: `snapToPolyline` con `rawHistory = points.slice(i-10, i+1)` (direccion desde la trayectoria cruda del usuario) y `history = out.slice(-5)` (referencia de continuidad desde lo ya proyectado).
3. Ultimo punto: snap al extremo de `segments` mas cercano (mismo radio) si lo hay.
4. Dos pasadas de neighbour-averaging (`25/50/25`, extremos fijos) para limpiar micro-jitter entre proyecciones que caen en segmentos contiguos.

Invocada por `ManualPathDrawer.endStroke` y por el boton "Centrar trazado".

---

## letterMask.js (fallback raster)

Usado cuando el input no es SVG o cuando la extraccion de `guideExtractor` no encuentra suficientes puntos. Rasteriza la imagen a una mascara binaria y precomputa un distance transform chamfer 3-4 para tirar puntos hacia el eje medial.

### Funciones exportadas

#### `async buildMaskFromImage(imageSrc, width, height)`
Carga cualquier imagen (PNG/JPG/SVG), la dibuja en canvas, clasifica cada pixel como "dentro" si `alpha > 128 && luminancia < 200`, y calcula el distance transform. Devuelve `{ mask, dist, width, height }`.

#### `async buildLetterMask(fillSvgContent, width, height)`
Variante que acepta el string de un SVG fill (sin pasar por `<img>`). Usa el mismo predicado de alfa para la mascara binaria. Hoy solo se conserva por compatibilidad; no tiene callers en la UI activa.

#### `centerStrokePoints(points, maskInfo, opts = {})`
Pasada iterativa de centrado (pre-smooth 8 iter, snap 12 iter con `maxStep = 5` y `pullStrength = 2.5`, post-smooth 2 iter). Se llama desde `adjustStrokeToGuide` cuando no hay polilinea SVG, y desde el boton "Centrar trazado" en el mismo caso.

#### `snapToCenterline(point, maskInfo, opts = {})`
Empuja un punto al eje medial usando el gradiente del distance field. Correccion radial, magnitud ~0 en el esqueleto. Aun se usa dentro de `centerStrokePoints` pero ya **no se invoca en tiempo real** durante el dibujo — solo en la pasada de ajuste al soltar.

#### `computeDistanceTransform(mask, width, height)`
Chamfer 3-4 en dos pasadas. **Exportado** para que `guideExtractor.js` lo reutilice sobre su mascara filtrada.

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

#### `generateOutlineSvgFromStrokes(strokePaths, width, height, strokeWidth = 40, borderWidth = 3)` (NUEVO)
Outline fallback como **letra hueca**: misma silueta que `generateFillSvgFromStrokes` pintada como un borde negro de `borderWidth` alrededor de un interior blanco.

Implementacion: dos capas apiladas de paths stroked sobre el mismo `d`:
1. Cada stroke con `strokeWidth` en negro → silueta exterior (`id="contornoN"`).
2. Cada stroke con `strokeWidth − 2·borderWidth` en blanco → relleno interior (sin id).

El orden es **todos los negros primero, luego todos los blancos**: si el usuario dibujo strokes que se solapan (bucle + cola de una "a" cursiva), el blanco de un stroke tapa el borde negro del vecino y no queda costura interna.

- `strokeWidth` debe coincidir con el que se pasa a `generateFillSvgFromStrokes` para que fill y outline compartan silueta (`GeneratorPage` pasa `fillStrokeWidth`).
- Cada path con `id="contorno1"`, `id="contorno2"`, ...

#### `generateDottedSvg(strokePaths, width, height, strokeWidth = 5, dashArray = '7,11')`
Emite un `<path id="path{i+1}">` dasheado por cada trazo, envueltos en un `<g id="path">`. Emite **rayas reales** (no puntos redondos), reproduciendo el visual del bundle de referencia.

- **Input**: `strokePaths: Array<{ id?, d }>` (producido por `ManualPathDrawer.handleFinalize`: `smooth(pts, 2)` → `M x,y L x,y ...`)
- **Output**: string SVG. `<g><g><g id="path">` envolviendo `<path id="path1" d="..." style="fill:none;stroke:#ccc;stroke-width:{N}px;stroke-linecap:round;stroke-dasharray:{D};"/>` por trazo.

**Defaults elegidos para coincidir con `ejemplo/trazado-letra-a/letter-dotted.svg`**:
- `strokeWidth = 5` (espesor ~5 px del capsule en la referencia)
- `dashArray = '7,11'` (dash 7 + gap 11, con caps redondeados da visible `12 + 6 = 18` de periodo, matching la referencia)

Si se pasa un `dashArray` muy corto en el primer componente (ej. `'0.1,16'`) el resultado seran puntos redondos en lugar de rayas — mantener el default salvo que se busque otro estilo.

Los ids `path1`, `path2`, ... concuerdan con los selectores de `letterAnimationPath` en el `data.json`.

#### `generateBaseSvg(strokePaths, width, height, stroke)` (NUEVO)
Genera el `base.svg`: template que replica la estructura de los componentes `LetterX` en `ejemplo/letters.js`. El reader hace `fetch` del archivo y lo inyecta via `innerHTML` en un `<div>` para animar los `<path>` con `stroke-dashoffset`, usa `<circle id="circle">` como marcador inicial y `<rect id="letterBg">` como fondo clickable.

- **Input**: `strokePaths: Array<{ d, points? }>`, `width`, `height`, `stroke` (numero concreto, normalmente `effStroke` de `GeneratorPage`).
- **Output**: string SVG **sin XML prolog ni DOCTYPE** (si los emitiera, al inyectarse via `innerHTML` dentro de un `<div>` el parser HTML los convierte en comentario bogus y las reglas CSS del reader no aplican — la letra sale toda negra). Estructura: `<svg class="svg-letter">` conteniendo:
  - `<rect id="letterBg" x="0" y="0" width="W" height="H"/>`
  - Un `<path id="path{i+1}" class="svgPath" stroke-width="S" fill="none" d="..."/>` por trazo.
  - `<circle id="circle" cx cy r/>` en el primer punto del primer trazo, con `r = Math.ceil(S / 1.4)`.

Usa atributos estaticos (`class`, `stroke-width`), no JSX (`className`, `strokeWidth`). `fill="none"` inline es fallback de atributo de presentacion — el CSS del reader (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`) sobreescribe, pero si falla al cargar los paths no se rellenan en negro.

---

## thumGenerator.js

Genera `thum.png` componiendo los SVGs existentes del trazado (fill + dotted).

### Funciones exportadas

#### `async generateThumPngBlob({ fillSvg, dottedSvg, width, height })`
- **Input**:
  - `fillSvg`: string SVG completo de `letter-fill.svg` (capa base — la letra rellena en negro)
  - `dottedSvg`: string SVG completo de `letter-dotted.svg` (capa superior — rayas dasheadas en `#ccc`)
  - `width`, `height`: tamaño del canvas de salida (tipicamente `letterSize` del `data.json`)
- **Output**: `Blob` PNG

**Proceso**: rasteriza `fillSvg` como imagen en un `<canvas>` → dibuja `dottedSvg` encima → exporta via `canvas.toBlob`. El resultado es la letra oscura con rayas claras superpuestas (efecto "carretera con linea central"), identico al `thum.png` del bundle de referencia.

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

## fontParser.js y pathSampler.js (LEGACY — no importados)

Ninguno de estos modulos se importa en la app actual. Se conservan como referencia por si alguna vez se quiere reintroducir la generacion automatica desde tipografias.

- **`fontParser.js`**: parsing de TTF/OTF/WOFF con opentype.js y extraccion de glifos como paths SVG. Funciones expuestas: `parseFont`, `glyphToSvgPathData`, `computeGlyphCanvasSize`, `getAvailableChars`.
- **`pathSampler.js`**: pipeline de esqueletonizacion Zhang-Suen + merge colineal + smoothing + resample + paths Bezier. Funciones: `samplePathPoints`, `samplePathPointsMultiStroke`, `extractSkeletonSegments`, `generateCenterlinePaths`, `extractPathsFromSvg`.

Si se decide depurar el repo, ambos pueden eliminarse sin romper nada.
