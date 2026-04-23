# Utilidades - Documentacion Tecnica

> **Importante (abril 2026)**: La app es dibujo manual con proyeccion al soltar sobre el esqueleto de un `guia.svg` subido por el usuario. Las utilidades "core" del flujo actual son `guideExtractor.js` (extraccion del esqueleto + proyeccion), `letterMask.js` (fallback raster), `dataGenerator.js`, `svgGenerator.generateBaseSvg` y `exportUtils.js`.
>
> **Codigo muerto** (no se importa en ningun lado, conservado como referencia): `fontParser.js`, `pathSampler.js`, `thumGenerator.js`, y todo `svgGenerator.js` excepto `generateBaseSvg` (`generateFillSvg`, `generateFillSvgFromStrokes`, `generateOutlineSvg`, `generateOutlineSvgFromStrokes`, `generateDottedSvg`). Tambien `letterMask.buildLetterMask` y `dataGenerator.computeDotCount` siguen exportados pero sin callers.

---

## guideExtractor.js (CORE)

Extrae el esqueleto desde el `guia.svg` subido por el usuario, y proyecta los trazos dibujados sobre la polilinea resultante. Es el corazon del ajuste al soltar el trazo.

### Pipeline

1. **Rasterizado aspect-fit** del SVG a 2× canvas (super-sampling para que los dashes sobrevivan al thresholding).
2. **Binarizado** segun el modo:
   - `'white-body'` (legado PNG): canvas pre-llenado negro, pixel cuenta si `min(R,G,B) >= minWhite` **y** `alpha >= 128`. Usado por el flujo antiguo de PNG con letra blanca sobre fondo coloreado (hoy sin callers activos).
   - `'any-opaque'` (flujo SVG actual): canvas transparente, pixel cuenta si `alpha >= minAlpha` (64 por defecto). Todo lo pintado en el SVG es guia.
3. **Connected components** flood-fill 8-way. Se descartan los blobs demasiado pequeños (especks de anti-aliasing) y los que caen por debajo de `largest × minComponentRatio`.
4. **Relleno de agujeros pequeños** (solo `'white-body'`): flechas, numeros y dots dentro del cuerpo de la letra se rellenan para no desviar el esqueleto.
5. **Morphological close** (`closePasses` pasadas de dilate + erode). En `'any-opaque'` el default es 4 — suficiente para cerrar los gaps entre dashes de un `guia.svg` y producir una linea continua.
6. **Zhang-Suen thinning** → esqueleto de 1 px.
7. **Pruning** de spurs cortas (`maxSpurLength`).
8. **Extension de endpoints**: Zhang-Suen se come 1-2 px en cada extremo; se extrapola la direccion del esqueleto hasta salirse del cuerpo para que la guia llegue a los extremos reales.
9. **Construccion del grafo**: cada pixel del esqueleto es un centroide; 8-connectivity → edges. Degree 1 → endpoints.
10. **Segmentacion**: split en junctions, merge de segmentos casi-colineales a traves de junction, filtrado de cortos, orientacion (top-first / left-first), sort top-left, smoothing 5 iter y conversion a path quadratic-bezier.

### Funciones exportadas

#### `async extractGuideMaskFromImage(imageSrc, width, height, opts = {})`

Ejecuta el pipeline completo y devuelve:

```
{
  mask: Uint8Array,           // mascara dilatada del esqueleto (width * height)
  dist: Float32Array,         // distance transform chamfer 3-4 de esa mascara
  width, height,
  centroids: [{x,y}],         // pixels del esqueleto en letter-space
  edges: [{a,b}],             // indices en centroids[]
  endpoints: [i, ...],        // centroids con degree 1
  segments: [{points, d}],    // polilineas smoothed por segmento (path "d" listo)
  segmentEndpoints: [{x,y}],  // extremos visibles de cada segmento (dedup)
  debug: { dotCount, centroids, edges, endpoints, segments, segmentEndpoints }
}
```

Retorna `null` si la extraccion falla (sin blobs o <2 centroides).

**Opciones**:

| Opt | Default (`'white-body'`) | Default (`'any-opaque'`) | Descripcion |
|-----|--------------------------|--------------------------|-------------|
| `mode` | `'white-body'` | `'any-opaque'` | Elige el binarizador |
| `minWhite` | 235 | (no aplica) | Umbral RGB para "letter body" |
| `minAlpha` | 128 | 64 | Umbral alfa |
| `minArea` | 80 | 20 | Area minima (high-res px) |
| `minComponentRatio` | 0.25 | 0.05 | Fraccion del blob mas grande |
| `closePasses` | 1 | 4 | Pasadas de dilate+erode (cierra dashes en SVG) |
| `maxSpurLength` | 6 | 6 | Pruning de spurs |
| `maxHoleFraction` | 0.08 | 0 | Relleno de agujeros internos (apagado en SVG) |
| `renderScale` | 2 | 2 | Super-sampling |

#### `async extractGuideFromSvg(svgSrc, width, height, opts = {})`

Thin wrapper sobre `extractGuideMaskFromImage` con `mode: 'any-opaque'`. Este es el entry point usado por `ManualPathDrawer` — rasteriza el `guia.svg` subido, cierra agresivamente los dashes y extrae el esqueleto. Los defaults del modo `'any-opaque'` (tabla de arriba) estan tuneados para dashes tipicos del punteado; `opts` los sobreescribe si es necesario.

#### `snapToPolyline(point, centroids, edges, opts = {})`

Proyecta un punto al segmento mas cercano de la polilinea, con sesgo direccional para no saltar a un tramo topologicamente lejano.

Modos de sesgo:
- Con `rawHistory` (recomendado, path crudo del cursor): calcula la tangente acumulando arco hacia atras hasta `dirLookback = 15px`, descompone `(proj - prev)` en `forward` (a favor de la tangente) y `lateral` (perpendicular), y suma al score `lateralBias * lateral² + backwardPenalty * max(0, -forward)²`. Por defecto `lateralBias = 2.5`, `backwardPenalty = 0.4`.
- Solo con `history` (proyectado): si no viene `rawHistory`, usa la historia proyectada para la tangente. Menos robusto porque una proyeccion errada contamina la direccion.
- Sin ninguna: fallback a `continuityBias * |proj - prev|²` (default 0.3).

`maxDist` (default 80 px) descarta proyecciones demasiado lejanas al cursor — si todas superan el radio devuelve el punto sin cambios.

#### `snapToEndpoint(point, centroids, endpoints, opts = {})`

Devuelve el endpoint (centroide de grado 1) mas cercano al punto, si esta dentro de `maxDist` (default 40). Si no hay ninguno cerca devuelve `null`.

#### `projectStrokeOnGuide(points, guide, opts = {})`

Orquesta la proyeccion de un trazo completo:

1. **Primer punto**: snap al extremo de `segments` mas cercano (radio `endpointRadius` = 20) o proyeccion libre. El snap usa `guide.segmentEndpoints` — los extremos de los segmentos visibles — no la lista cruda de pixels degree-1, que incluye roturas de ciclos y vecinos de junction que no son visibles.
2. **Cada punto siguiente**: `snapToPolyline` con `rawHistory = points.slice(i-10, i+1)` (direccion desde la trayectoria cruda del usuario) y `history = out.slice(-5)` (referencia de continuidad desde lo ya proyectado).
3. **Ultimo punto**: snap al extremo de `segments` mas cercano (mismo radio) si lo hay.
4. **Dos pasadas de neighbour-averaging** (`25/50/25`, extremos fijos) para limpiar micro-jitter entre proyecciones en segmentos contiguos.

Invocada por `ManualPathDrawer.endStroke` y por el boton "Centrar trazado".

---

## letterMask.js (fallback raster)

Usado cuando la extraccion del esqueleto de `guia.svg` no encuentra suficientes puntos (p.ej. un SVG degenerado). Rasteriza la imagen a una mascara binaria y precomputa un distance transform chamfer 3-4 para tirar puntos hacia el eje medial.

### Funciones exportadas

#### `async buildMaskFromImage(imageSrc, width, height)`

Carga cualquier imagen (SVG, PNG, JPG), la dibuja en canvas, clasifica cada pixel como "dentro" si `alpha > 128 && luminancia < 200`, y calcula el distance transform. Devuelve `{ mask, dist, width, height }`.

#### `async buildLetterMask(fillSvgContent, width, height)` *(sin callers)*

Variante que acepta el string de un SVG sin pasar por `<img>`. Sin callers en la UI activa; conservado por compatibilidad.

#### `centerStrokePoints(points, maskInfo, opts = {})`

Pasada iterativa de centrado (pre-smooth 8 iter, snap 12 iter con `maxStep = 5` y `pullStrength = 2.5`, post-smooth 2 iter). Se llama desde `adjustStrokeToGuide` cuando no hay polilinea extraida, y desde el boton "Centrar trazado" en el mismo caso.

#### `snapToCenterline(point, maskInfo, opts = {})`

Empuja un punto al eje medial usando el gradiente del distance field. Se sigue usando dentro de `centerStrokePoints` pero ya no se invoca en tiempo real.

#### `computeDistanceTransform(mask, width, height)`

Chamfer 3-4 en dos pasadas. Exportado para que `guideExtractor.js` lo reutilice sobre su mascara filtrada.

---

## svgGenerator.js

Hoy **solo se usa `generateBaseSvg`**. El resto (`generateFillSvg`, `generateFillSvgFromStrokes`, `generateOutlineSvg`, `generateOutlineSvgFromStrokes`, `generateDottedSvg`) son codigo muerto — ningun otro modulo los importa. Se mantienen por si hiciera falta revertir el cambio, pero se pueden eliminar.

### `generateBaseSvg(strokePaths, width, height, stroke)` (CORE)

Genera el `base.svg`: template que replica la estructura de los componentes `LetterX` en `ejemplo/letters.js`. El reader hace `fetch` del archivo y lo inyecta via `innerHTML` en un `<div>` para animar los `<path>` con `stroke-dashoffset`, usa `<circle id="circle">` como marcador inicial y `<rect id="letterBg">` como fondo clickable.

- **Input**: `strokePaths: Array<{ d, points? }>`, `width`, `height`, `stroke` (numero concreto, normalmente `effStroke` de `GeneratorPage` — 16 por default).
- **Output**: string SVG **sin XML prolog ni DOCTYPE** (si los emitiera, al inyectarse via `innerHTML` dentro de un `<div>` el parser HTML los convierte en comentario bogus y las reglas CSS del reader no aplican — la letra sale toda negra). Estructura: `<svg class="svg-letter">` conteniendo:
  - `<rect id="letterBg" x="0" y="0" width="W" height="H"/>`
  - Un `<path id="path{i+1}" class="svgPath" stroke="#f04e23" fill="none" stroke-width="S" d="..."/>` por trazo.
  - `<circle id="circle" cx cy r fill="blue"/>` en el primer punto del primer trazo, con `r = Math.ceil(S / 1.4)`.

Usa atributos estaticos (`class`, `stroke-width`), no JSX (`className`, `strokeWidth`). Los atributos `stroke="#f04e23"` y `fill="none"` en cada `<path>`, junto con `fill="blue"` en el `<circle>`, actuan como **fallbacks de atributo de presentacion**: el CSS del reader (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`) sobreescribe, pero si falla al cargar los paths no se rellenan en negro y el marcador sigue siendo visible.

---

## dataGenerator.js

Genera el `data.json`, maneja nomenclatura y computa valores por letra.

### `generateDataJson({ letter, type, letterSize, dotList, animationPaths, animationPathStroke, dotSize })`

Construye el objeto `data.json` completo.

**Campos emitidos** (mismo shape que `ejemplo/trazado-letra-a/data.json`, que es la referencia canonica del reader): `activityId`, `sectionId`, `title` (es/val + audio pointers), `character`, `letterFill`, `letterOutline`, `letterDotted`, `letter`, `letterSize`, `animationPathStroke`, `letterAnimationPath`, `dotSize`, `playButtonPosition`, `dotList`. Los pointers `character`/`letterFill`/`letterOutline`/`letterDotted` y los audios referencian assets que esta herramienta **no produce** — los aporta el pipeline de contenido y se despliegan junto al bundle. El JSON los incluye porque el reader los lee; sacarlos rompe el reader.

**Logica del campo `letter`**:
- Ligada: `letter.toLowerCase()` → `"a"`, `"ch"`, `"ll"`, `"ñ"` (sin mapeo a `"ny"`)
- Mayusculas: `"Upper" + Capitalized` → `"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"`

**Calculo de `time` en animationPaths**:
- Si el caller provee `p.time`, se usa tal cual
- Fallback: `Math.max(2, Math.round(p.length / 50))`
- `GeneratorPage.generateForLetter` actualmente pasa `time = Math.max(2, Math.round(coordinates.length / 4))`

### `getFolderName(letter, type)`

Nombre de carpeta.
- Mapeo especial: `ñ` → `ny`; `ch` y `ll` se mantienen
- Ligada: `trazado-letra-{base}`
- Mayusculas: `trazado-letra-{base}-mayus`

### `computeLetterParams(letter, type, canvasW)`

Computa `dotSize` y `animationPathStroke` para una letra.

- **Input**: letra, tipo, ancho del canvas
- **Output**: `{ dotSize: number, animationPathStroke: number }`
- **`animationPathStroke`**: fijo en **16** para todas las letras y ambos tipos. Este valor se embebe en `base.svg` como `stroke-width="16"` para replicar la referencia canonica (`ejemplo/trazado-letra-a/base.svg`). El usuario puede sobreescribirlo desde el input `strokeWidth` del Paso 2 (`0 = usar el default 16`, `>0 = forzar otro valor`).
- **`dotSize` mayusculas**: 34 (40 si `canvasW > 240`).
- **`dotSize` ligada**: ramas por `canvasW` (28-38) + overrides especificos para `e`, `i`, `k`, `m`, `n`, `u`, `p`.

### `computeDotCount(pathLengthPx)` *(sin callers)*

Cantidad recomendada de puntos para un trazo segun su longitud. Exportado pero no se llama desde la UI actual (el modo manual usa el `dotCount` que el usuario configura, igual para todos los trazos).

### Constantes exportadas

- `SPANISH_LETTERS`: 27 letras (a-z + ñ)
- `SPECIAL_COMBOS`: `['ch', 'll']`

---

## exportUtils.js

Exportacion de trazados como ZIP.

### Funciones exportadas

#### `async downloadSingleTrazado(trazado)`

Crea un ZIP con una sola letra y lo descarga como `{folderName}.zip`.

#### `async exportAllTrazados(trazadosList, baseType)`

Exporta multiples trazados en un solo ZIP agrupados bajo `ligada/` o `mayusculas/`. Descarga como `trazados-{baseType}.zip`.

#### `async writeTrazadoToReader(trazado, type)`

POST a `/__write-reader-trazado` con payload `{ type, folderName, files: { 'data.json', 'base.svg' } }`. El middleware registrado en `vite.config.js` escribe los archivos en `public/reader/libro/assets/trazados/{type}/{folderName}/`. Solo funciona en `npm run dev`; lanza `Error(msg)` con el mensaje del servidor si devuelve no-2xx.

### Helper interno `writeTrazadoFiles(folder, trazado)`

Escribe en el folder de JSZip solamente:
1. `data.json` (`JSON.stringify(trazado.dataJson, null, 2)`)
2. `base.svg` (si `trazado.baseSvg` existe)

**Ya no escribe**: `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `thum.png`, `character.png`, `fondo.png`, audios. El import de `thumGenerator` fue eliminado.

---

## Codigo muerto (mantenido como referencia)

Los siguientes archivos y funciones ya no tienen callers en el flujo activo. Se pueden eliminar sin romper nada si se decide depurar el repo:

- **`src/utils/thumGenerator.js`** — generaba `thum.png` rasterizando fill+dotted. El bundle ya no incluye `thum.png`.
- **`src/utils/svgGenerator.js`** excepto `generateBaseSvg` — generaba `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`. Ninguno se exporta ya.
- **`src/utils/fontParser.js`** — flujo de tipografias (opentype.js). Eliminado de la app antes del refactor de dos-SVG.
- **`src/utils/pathSampler.js`** — skeletonizacion + resample de paths. Sustituido por la segmentacion del `guideExtractor`.
- **`letterMask.buildLetterMask`** — accepting SVG content string, sin callers.
- **`dataGenerator.computeDotCount`** — la UI usa dotCount fijo configurado por el usuario.
