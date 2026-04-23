# Componentes - Documentacion Detallada

> **Contexto (abril 2026)**: Flujo de dos-SVG-subidos. En el Paso 1 el usuario sube `base.svg` (ilustración) + `guia.svg` (punteado) por letra. En el Paso 2 ambos se apilan como guia visual y el usuario dibuja encima; al soltar el trazo se proyecta sobre el esqueleto de `guia.svg`. El bundle exportado es solo `data.json` + `base.svg` (plantilla animable). El `base.svg` que sube el usuario y el que emitimos comparten nombre pero son ficheros distintos: el subido es la ilustración decorativa, el emitido es la plantilla con los `<path>` animados por el reader. Los modos PNG-reference, font y svg-bundle desaparecieron.

## GeneratorPage.jsx

Wizard de 3 pasos (imagenes → trazado → exportar).

### Estado (useState)

| Variable | Tipo | Default | Descripcion |
|----------|------|---------|-------------|
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Tipo de letra |
| `selectedLetters` | string[] | `[]` | Array de **a lo sumo una** letra (seleccion exclusiva) |
| `generatedTrazados` | object | `{}` | Map letra → datos generados |
| `generating` | boolean | `false` | Flag durante la generacion |
| `currentStep` | number | 1 | Paso actual (1-3) |
| `dotCount` | number | 25 | Puntos por trazo al resamplear |
| `dotSize` | number | 0 | 0 = auto via `computeLetterParams`, >0 = forzado |
| `canvasWidth` | number | 380 | Ancho del canvas |
| `canvasHeight` | number | 340 | Alto del canvas |
| `strokeWidth` | number | 0 | 0 = auto, >0 = forzado |
| `manualDrawings` | object | `{}` | Map letra → `{ dotList, strokePaths }` |
| `images` | object | `{}` | Map letra → `{ base: dataURL, guia: dataURL }` |

`activeLetter = selectedLetters[0]`. `activeImages = images[activeLetter] || {}`. `activeBase = activeImages.base`. `activeGuia = activeImages.guia`.

### Persistencia

Todo se vuelca a `window.__generatorState` (incluyendo `images`) en un `useEffect` sin array de dependencias — sobrevive a la navegacion a Preview. Paso actual en URL `?step=N`.

### Handlers principales

#### `toggleLetter(letter)`
Selecciona **una sola** letra (click en la misma la deselecciona; click en otra la reemplaza).

#### `handleSvgUpload(kind)` / `clearSvg(kind)`
`kind` es `'base'` o `'guia'`. Lee el archivo con `FileReader.readAsDataURL` — acepta solo `.svg` (mime `image/svg+xml`). Guarda en `images[activeLetter][kind]`. `clearSvg` borra solo el slot correspondiente; si la letra queda sin ningun SVG se elimina la entrada entera.

Tras guardar el dataURL, llama a `parseSvgDims` para extraer el tamaño intrinseco del SVG (atributos `width`/`height`, fallback a `viewBox`). Si no coincide con `canvasWidth`×`canvasHeight`, emite un `console.warn` con ambos valores. **No** modifica el canvas automaticamente: `canvasWidth`/`canvasHeight` alimentan `computeLetterParams` (dotSize / animationPathStroke) y el escalado del drawer, asi que sobreescribirlos silenciosamente cambiaria los parametros del dibujo. El usuario decide si ajusta en el Paso 2 para que los viewBox coincidan.

#### `parseSvgDims(dataUrl)`
Helper local (fuera del componente). Decodifica el payload del dataURL (`base64` o URL-encoded), parsea el SVG con `DOMParser`, y devuelve `{ width, height }` redondeados — primero de los atributos `width`/`height` (strippeando unidades via `parseFloat`), luego del `viewBox` si los atributos no son parseables. Retorna `null` si nada se puede parsear. Usado solo para el warning anterior.

#### `handleManualComplete(letter, result)`
Callback del `ManualPathDrawer`. Guarda `{ dotList, strokePaths }` en `manualDrawings[letter]`.

#### `generateForLetter(letter)`
1. Lee `manualDrawings[letter]` — error si no existe
2. Usa `canvasWidth`/`canvasHeight` tal cual
3. `effDotSize`/`effStroke` = override `0/>0` + `computeLetterParams`
4. `animationPaths`: por cada stroke `{ length, time: max(2, round(length/4)) }`
5. `baseSvg`: `generateBaseSvg(strokePaths, w, h, effStroke)` — el unico SVG que se produce
6. Construye `data.json` via `generateDataJson`

Retorno: `{ letter, folderName, baseSvg, dataJson, dotList, strokePaths }`.

Los campos `fillSvg`, `outlineSvg` (y el antiguo `dottedSvg` generado) **ya no existen** en el resultado — la generacion de esos SVG se eliminó.

#### `handleGenerate()` / `handleExportSingle(letter)` / `handleExportAll()`
Genera el ZIP con solo `data.json` + `base.svg`.

#### `handlePreview(letter)`
Coloca `{ dataJson, baseSvg, guiaSvg }` en `window.__trazadoPreview` y navega a `/preview`. Los dos SVG vienen de `images[letter]` (los archivos que subió el usuario en el Paso 1) para que el preview reproduzca fielmente el fondo visible durante el dibujo. El `baseSvg` **generado** (la plantilla animable) no se pasa a PreviewPage porque el preview reconstruye la animación desde `dataJson.dotList` — si lo pasáramos chocaría con la clave del `baseSvg` subido.

#### `handlePreviewInReader(letter)`
Escribe `data.json` + `base.svg` en el reader local via el middleware `POST /__write-reader-trazado` (registrado en `vite.config.js`) y abre la URL del reader en una pestaña nueva. Solo funciona en `npm run dev`.

### UI por Paso

- **Paso 1 — Imagenes**: Toggle ligada/mayusculas + grid de letras (las que tienen ambos SVG muestran ✓) + panel de carga con dos slots lado-a-lado (`base.svg` ilustración y `guia.svg` punteado), cada uno con su preview individual 110×90. Si ambos estan cargados se muestra una vista apilada 200×170 para confirmar alineacion. Los inputs aceptan `.svg, image/svg+xml`. `canAdvanceFromStep1 = activeLetter && activeBase && activeGuia`.
- **Paso 2 — Trazado**: Config (canvas w/h, dotCount, dotSize, strokeWidth). Debajo, el `ManualPathDrawer` con `baseSvg`/`guiaSvg` pasados como props. Boton "Generar y continuar".
- **Paso 3 — Exportar**: Lista de trazados generados con info por letra (canvas, dotSize, stroke, N trazos, puntos por trazo). Botones `Preview`, `Preview en reader`, `Exportar`, `Exportar todos como ZIP`.

---

## ManualPathDrawer.jsx

Canvas de dibujo manual con proyeccion diferida al soltar el trazo. Produce `{ dotList, strokePaths }` al guardar.

### Props

| Prop | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `letter` | string | `''` | Letra (solo display) |
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Display |
| `baseSvg` | string | `''` | dataURL de `base.svg` (ilustración subida por el usuario) — fondo visual (zIndex 1) |
| `guiaSvg` | string | `''` | dataURL de `guia.svg` (punteado subido por el usuario) — guia visual (zIndex 2) **y** fuente del esqueleto de snap |
| `width`, `height` | number | 380, 340 | Dimensiones del canvas en espacio de letra |
| `dotCount` | number | 25 | Puntos por trazo al resamplear (default si el prop no se pasa) |
| `dotSize` | number | 33 | Solo informativo |
| `onComplete` | function | - | Callback con `{ dotList, strokePaths }` |
| `onCancel` | function | - | Callback al cancelar |

### Estado interno

- `isDrawing` (boolean): hay trazo en curso
- `strokes`: trazos completados (ya proyectados sobre la guia al soltar)
- `currentStroke`: puntos del trazo en curso (crudos, sin proyectar)
- `cursorPos`: para el crosshair
- `maskRef` (ref): guide object completo (`{ centroids, edges, endpoints, segmentEndpoints }`) + mask raster + distance transform, o el objeto del fallback raster si la extraccion del SVG no dio suficientes puntos
- `guideRef` (ref): `{ centroids, edges, endpoints, segmentEndpoints }` cuando se extrajo la polilinea del `guia.svg`
- `guideDebug` (state): contenido del debug para el overlay
- `showGuideDebug` (state): toggle del overlay
- `maskMode` (state): `'skeleton'` | `'fallback'` | `'none'` — decide que adjuster usar

### Carga de la guia (useEffect)

Cuando cambia `guiaSvg` / `width` / `height`:

1. Llama `extractGuideFromSvg(guiaSvg, width, height)`. Si devuelve ≥3 centroides y ≥1 edge → `guideRef.current = { centroids, edges, endpoints, segmentEndpoints }`, `maskMode = 'skeleton'`.
2. Si falla → `buildMaskFromImage(guiaSvg, ...)` como fallback raster (distance transform sobre pixeles oscuros). `maskMode = 'fallback'`.
3. Si tambien falla → `maskMode = 'none'`, el trazo se guarda crudo.

`baseSvg` **no** se procesa — solo se renderiza visualmente. El esqueleto se obtiene unicamente de `guia.svg`.

### Pipeline de dibujo

Realtime (durante el arrastre):
1. **EMA** con `SMOOTH_ALPHA = 0.5` contra el punto anterior del trazo.
2. **Gate de distancia minima** (`1.2 px`) — no oversamplear.
3. Se guarda el punto tal cual. **No hay snap en tiempo real** — el cursor va libre sobre la guia visual.

Al soltar (`endStroke`):
- Si el trazo tiene <2 puntos, se descarta.
- Si no, se llama `adjustStrokeToGuide(currentStroke)`:
  - `maskMode === 'skeleton'` → `projectStrokeOnGuide(points, guideRef.current)` (ver `UTILITIES.md`).
  - `maskMode === 'fallback'` → `centerStrokePoints(points, maskRef.current)` (pasada iterativa por distance transform).
  - `maskMode === 'none'` → se deja como esta.
- El trazo ajustado se agrega a `strokes`.

### Atajos de teclado

| Tecla | Accion |
|-------|--------|
| `N` | Forzar fin del trazo actual |
| `Ctrl+Z` / `Cmd+Z` | Deshacer ultimo trazo |
| `Enter` | Finalizar y guardar |
| `Escape` | Limpiar todo |

### Botones del header

- **Deshacer (Ctrl+Z)**: quita el ultimo trazo completado
- **Limpiar (Esc)**: borra todos los trazos
- **Centrar trazado**: re-aplica `adjustStrokeToGuide` a todos los trazos. Requiere `guiaSvg` cargado.
- **Ver guia** (solo si hay `guideDebug`): toggle del overlay de depuracion — dibuja los edges en cian, los centroides en verde azulado oscuro, y los endpoints en naranja grande. Permite verificar visualmente la calidad de la extraccion del esqueleto.
- **Guardar (Enter)**: dispara `handleFinalize`

### Indicador de modo

En la barra de atajos:
- `skeleton` → "Ajuste al soltar: esqueleto de guia.svg (N puntos)" en verde.
- `fallback` → "Ajuste al soltar: centrado por imagen (esqueleto de guia.svg no detectado)" en naranja.
- `none` → (ningun texto).

### Visualizacion

- Canvas escalado 1.4× (`transform: scale(1.4)` sobre el hijo); el borde cambia de gris a naranja al dibujar.
- **zIndex 1** — `base.svg` (ilustración subida) como `<img>` a 100% opacidad, `object-fit: contain`.
- **zIndex 2** — `guia.svg` (punteado subido) como `<img>` a 100% opacidad, `object-fit: contain`. Es la guia visible que el usuario sigue.
- **zIndex 5** — SVG overlay con trazos completados (polyline naranja 70% + marcador inicio azul + marcador fin verde + numero), trazo actual (polyline naranja opaca), crosshair y overlay de debug de la polilinea extraida.

### Proceso de finalizacion (`handleFinalize`)

1. Combina `strokes` (ya proyectados en `endStroke`) + `currentStroke` si tiene ≥2 puntos. El trazo en curso se pasa por `adjustStrokeToGuide(currentStroke)` antes de agregarse, para que quede en el mismo espacio que los trazos completados. Este caso se dispara cuando el usuario presiona `Enter` mientras dibuja — sin este paso, el ultimo trazo quedaria crudo mientras el resto iba proyectado, produciendo un `dotList` inconsistente en el export.
2. Por cada trazo ya ajustado:
   - `resample(pts, dotCount)` a N puntos equidistantes
   - Formato `{ coords: [x.toFixed(3), y.toFixed(3)] }`
   - Marca esquinas donde |Δangulo| > π/4
   - `dragger` = primer punto con `(x − 10, y − 10).toFixed(0)`. El offset de −10 px centra el `#fixedDot` del reader (un `div` de 20×20 px posicionado por su esquina superior-izquierda via `transform: translate`) sobre el inicio real del trazo. Sin esta resta el fixedDot aparece 10 px abajo-a-la-derecha del trazo al finalizar la animación.
3. `strokePaths`: `smooth(pts, 2)` → path `"d"` con `M` + `L` → `{ id: 'path{i+1}', d, points: smoothed }`.
4. Llama `onComplete({ dotList, strokePaths })`.

`strokePaths` es el unico pipeline que alimenta `base.svg`. Ya no se emite `skeletonPaths` hacia `onComplete` (el generador no lo necesita — dejo de generar `letter-dotted.svg`).

### Conversion de coordenadas

```javascript
toLetterCoords(clientX, clientY) {
  const rect = container.getBoundingClientRect()
  return {
    x: (clientX - rect.left - el.clientLeft) / SCALE,   // SCALE = 1.4
    y: (clientY - rect.top - el.clientTop) / SCALE,
  }
}
```

El contenedor renderiza el hijo scalado via `transform: scale(1.4)` y usa `box-sizing: content-box` con un borde de 2 px. `getBoundingClientRect` devuelve el **border-box**, asi que sin la correccion cada click quedaba desplazado `borderWidth / SCALE` letter-units abajo y a la derecha (≈ 1.43 u con un borde de 2 px). Restar `clientLeft` / `clientTop` (= anchos del borde) mapea el pixel superior-izquierdo del area dibujable a letter-space `(0, 0)`.

### Funciones auxiliares internas

- `resample(points, n)`: longitud acumulada + interpolacion lineal
- `smooth(points, iterations)`: promedio ponderado 25-50-25, manteniendo extremos

---

## PreviewPage.jsx

Pagina de preview interactivo. Simula como el componente consumidor presenta el trazado.

### Estado

| Variable | Tipo | Descripcion |
|----------|------|-------------|
| `previewData` | object/null | `{ dataJson, baseSvg, guiaSvg }` — `baseSvg` aquí es la **ilustración subida** por el usuario (no la plantilla animable generada) |
| `stepIdx` | number | Indice del trazo actual |
| `dotIdx` | number | Indice del siguiente punto a tocar |
| `mousePos` | `{ x, y }` | Cursor en coordenadas de letra |
| `tracedPath` | array | Puntos tocados del trazo actual |
| `completedStrokes` | array | Paths de trazos anteriores |
| `phase` | `'idle'|'ready'|'tracing'|'done'` | Fase |
| `showFill` | boolean | Tras completar oculta el overlay de dots (ya no hay fillSvg que revelar) |
| `debugMode` | boolean | Debug visual (default `true`) |

### Carga de datos

1. **Desde GeneratorPage**: lee `window.__trazadoPreview` al montar. Incluye los SVG originales subidos (`baseSvg` ilustración, `guiaSvg` punteado).
2. **Upload manual**: carga `data.json` + `base.svg` (aquí interpretado como ilustración subida) + opcionalmente `guia.svg` via input file. Si el usuario incluye también la plantilla animable generada (también llamada `base.svg`), la última que se lea gana — el flujo habitual es la entrega desde el generador, este upload manual es fallback.

### Mecanica de trazado

1. **Phase `ready`**: punto de inicio pulsando (azul) en la posicion del `dragger`. Click para comenzar.
2. **Phase `tracing`**: cursor personalizado (circulo naranja). No requiere mantener el mouse presionado.
   - Hit detection: `distancia < max(dotSize, 28)` px al siguiente dot
   - Al tocar un dot: se agrega a `tracedPath`, avanza `dotIdx`
   - Al completar un trazo: se archiva en `completedStrokes`, avanza `stepIdx`, resetea `dotIdx` y `tracedPath`
3. **Phase `done`**: se oculta el overlay de dots/strokes; queda visible solo el fondo (ilustración `base.svg` + punteado `guia.svg`). Boton "Reiniciar".

### Capas visuales (z-index)

1. **z-index 1**: `base.svg` ilustración subida (si existe).
2. **z-index 2**: `guia.svg` punteado subido (si existe).
3. **z-index 5**: SVG overlay con trazos completados (verde), trazo actual (naranja), dots debug.
4. **z-index 8**: Punto de inicio pulsante (azul).
5. **z-index 10**: Cursor dragger (naranja).

La ilustración (`baseSvg`) y el punteado (`guiaSvg`) se reciben como dataURL (desde `window.__trazadoPreview`) o como texto SVG (desde upload manual). La render logica distingue por el prefijo: `data:` / `http` → `<img>`; otro → `dangerouslySetInnerHTML`.

### Panel de debug

Muestra: phase, step, dot actual, coordenadas del mouse, distancia al target, hit radius, canvas size/scale/dotSize, resumen del `dotList` en JSON.

### Conversion de coordenadas (`screenToLetter`)

Idéntica correccion que en `ManualPathDrawer`: el contenedor es `content-box` con un borde de 2 px, asi que `getBoundingClientRect` parte del border-box. Se resta `el.clientLeft` / `el.clientTop` al offset antes de dividir por `SCALE = 1.4`, de modo que la deteccion de hit con los dots queda en el mismo espacio en el que se dibujaron. Sin esta correccion, el hit radius efectivo estaba desplazado ≈ 1.43 u hacia abajo-derecha y los dots de la cabecera de algunos trazos quedaban fuera de alcance.

---

## App.jsx

Layout principal con navegacion (React Router).

### Rutas

| Path | Componente | Descripcion |
|------|-----------|-------------|
| `/` | `HomePage` | Landing |
| `/generator` | `GeneratorPage` | Wizard |
| `/preview` | `PreviewPage` | Preview interactivo |

Header con links (NavLink / useLocation para marcar activo): Inicio, Generador, Preview.

---

## HomePage.jsx

Landing minimalista: hero con titulo + subtitulo + unico boton "Comenzar a Generar" → `/generator`. No hay feature cards ni link directo a Preview (se accede via el export desde el generador).
