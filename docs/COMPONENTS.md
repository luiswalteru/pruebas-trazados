# Componentes - Documentacion Detallada

> **Contexto (abril 2026)**: Dibujo manual + proyeccion al soltar sobre la polilinea extraida del SVG de referencia. Los modos `font`/`svg-bundle`, el upload de fuente y los uploads de audio/imagen asset desaparecieron.

## GeneratorPage.jsx

Wizard de 3 pasos (imagen → trazado → exportar).

### Estado (useState)

| Variable | Tipo | Default | Descripcion |
|----------|------|---------|-------------|
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Tipo de letra |
| `selectedLetters` | string[] | `[]` | Array de **a lo sumo una** letra (seleccion exclusiva) |
| `generatedTrazados` | object | `{}` | Map letra -> datos generados |
| `generating` | boolean | `false` | Flag durante la generacion |
| `currentStep` | number | 1 | Paso actual (1-3) |
| `dotCount` | number | 0 | Puntos por trazo al resamplear (0 = usa default del drawer) |
| `dotSize` | number | 0 | 0 = auto via `computeLetterParams`, >0 = forzado |
| `canvasWidth` | number | 380 | Ancho del canvas |
| `canvasHeight` | number | 340 | Alto del canvas |
| `strokeWidth` | number | 0 | 0 = auto, >0 = forzado |
| `dottedStrokeWidth` | number | 5 | Grosor del dash en `letter-dotted.svg` |
| `dottedDash` | number | 7 | Longitud del dash |
| `dottedGap` | number | 11 | Longitud del gap |
| `manualDrawings` | object | `{}` | Map letra -> `{ dotList, strokePaths }` |
| `images` | object | `{}` | Map letra -> dataURL de la imagen de referencia |

`activeLetter = selectedLetters[0]`. `activeImage = images[activeLetter]`.

### Persistencia

Todo se vuelca a `window.__generatorState` (incluyendo `images`) en un `useEffect` sin array de dependencias — sobrevive a la navegacion a Preview. Paso actual en URL `?step=N`.

### Handlers principales

#### `toggleLetter(letter)`
Selecciona **una sola** letra (click en la misma la deselecciona; click en otra la reemplaza).

#### `handleImageUpload(e)` / `clearImage()`
Lee el archivo con `FileReader.readAsDataURL` — acepta `.svg`, `.png`, `.jpg`, `.jpeg` (mime `image/svg+xml`, `image/png`, `image/jpeg`). Guarda en `images[activeLetter]`.

#### `handleManualComplete(letter, result)`
Callback del `ManualPathDrawer`. Guarda `{ dotList, strokePaths }` en `manualDrawings[letter]`.

#### `generateForLetter(letter)`
1. Lee `manualDrawings[letter]` — error si no existe
2. Usa `canvasWidth`/`canvasHeight` tal cual
3. `effDotSize`/`effStroke` = override 0/>0 + `computeLetterParams`
4. `letter-fill.svg` / `letter-outline.svg`: siempre stroke-based (la imagen de referencia es raster/ilustrada, no se vectoriza). `fillStrokeWidth = max(20, effDotSize * 1.2)` para que el fill cubra bien.
5. `letter-dotted.svg`: `generateDottedSvg(strokePaths, w, h, dottedStrokeWidth, "${dottedDash},${dottedGap}")` — el usuario controla el espesor y dash/gap.
6. `animationPaths`: por cada stroke `{ length, time: max(2, round(length/4)) }`.
7. Construye `data.json` via `generateDataJson`.

Retorno: `{ letter, folderName, fillSvg, outlineSvg, dottedSvg, dataJson, dotList, strokePaths }`.

#### `handleGenerate()` / `handleExportSingle(letter)` / `handleExportAll()`
Export es async (genera `thum.png`).

#### `handlePreview(letter)`
Coloca `{ dataJson, fillSvg, outlineSvg, dottedSvg }` en `window.__trazadoPreview` y navega a `/preview`.

### UI por Paso

- **Paso 1 — Imagen**: Toggle ligada/mayusculas + grid de letras (las que tienen imagen muestran ✓) + panel de carga con preview (160×140 contain). `canAdvanceFromStep1 = activeLetter && activeImage`. El input `file` acepta `.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg`.
- **Paso 2 — Trazado**: Config (canvas w/h, dotCount, dotSize, strokeWidth, dottedStrokeWidth/dash/gap). Debajo, el `ManualPathDrawer` con la imagen pasada como `imageSrc`. Boton "Generar y continuar".
- **Paso 3 — Exportar**: Lista de trazados generados con info por letra (canvas, dotSize, stroke, N trazos, puntos por trazo). Botones `Preview`, `Exportar`, `Exportar todos como ZIP`.

---

## ManualPathDrawer.jsx

Canvas de dibujo manual con proyeccion diferida al soltar el trazo. Produce `{ dotList, strokePaths }` al guardar.

### Props

| Prop | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `letter` | string | `''` | Letra (solo display) |
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Display |
| `imageSrc` | string | `''` | Imagen de referencia (dataURL). SVG -> extractor; PNG/JPG -> mask clasico |
| `width`, `height` | number | 380, 340 | Dimensiones del canvas en espacio de letra |
| `dotCount` | number | 40 | Puntos por trazo al resamplear |
| `dotSize` | number | 33 | Solo informativo |
| `onComplete` | function | - | Callback con `{ dotList, strokePaths }` |
| `onCancel` | function | - | Callback al cancelar |

### Estado interno

- `isDrawing` (boolean): hay trazo en curso
- `strokes`: trazos completados (ya proyectados sobre la guia al soltar)
- `currentStroke`: puntos del trazo en curso (crudos, sin proyectar)
- `cursorPos`: para el crosshair
- `maskRef` (ref): mask raster + distance transform si se uso el fallback (PNG/JPG) o si el SVG no dio suficientes puntos
- `guideRef` (ref): `{ centroids, edges, endpoints }` cuando se extrajo la polilinea del SVG
- `guideDebug` (state): mismo contenido que `guideRef.current` + `dotCount`, usado para el overlay de debug
- `showGuideDebug` (state): toggle del overlay
- `maskMode` (state): `'svg-dots'` | `'fallback'` | `'none'` — decide que adjuster usar en `adjustStrokeToGuide`

### Carga de la guia (useEffect)

Cuando cambia `imageSrc` / `width` / `height`:

1. Si `isSvgSource(imageSrc)` → intenta `extractGuideMaskFromImage`. Si devuelve ≥3 puntos y ≥1 edge → `guideRef = { centroids, edges, endpoints }`, `maskMode = 'svg-dots'`.
2. En cualquier otro caso (raster, SVG degenerado, error) → `buildMaskFromImage` y `maskMode = 'fallback'`.
3. Si tampoco eso funciona → `maskMode = 'none'`, el trazo se guarda crudo.

### Pipeline de dibujo

Realtime (durante el arrastre):
1. **EMA** con `SMOOTH_ALPHA = 0.5` contra el punto anterior del trazo.
2. **Gate de distancia minima** (`1.2 px`) — no oversamplear.
3. Se guarda el punto tal cual. **No hay snap en tiempo real** — el cursor va libre sobre la guia visual.

Al soltar (`endStroke`):
- Si el trazo tiene <2 puntos, se descarta.
- Si no, se llama `adjustStrokeToGuide(currentStroke)`:
  - `maskMode === 'svg-dots'` → `projectStrokeOnGuide(points, guideRef.current)` (ver `UTILITIES.md`).
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
- **Centrar trazado**: re-aplica `adjustStrokeToGuide` a todos los trazos (util para repetir el ajuste o aplicarlo a un trazo que no se haya soltado por mouseUp limpio). Habilitado cuando hay trazos; usa polilinea si esta disponible, si no el fallback raster.
- **Ver guia** (solo si hay `guideDebug`): toggle del overlay de depuracion — dibuja los edges en cian, los centroides en verde azulado oscuro, y los endpoints en naranja grande. Permite verificar visualmente la calidad de la extraccion.
- **Guardar (Enter)**: dispara `handleFinalize`

### Indicador de modo

En la barra de atajos:
- `svg-dots` → "Ajuste al soltar: guia SVG (N puntos)" en verde.
- `fallback` → "Ajuste al soltar: centrado por imagen" en naranja.
- `none` → (ningun texto).

### Visualizacion

- Canvas escalado 1.4× (`transform: scale(1.4)` sobre el hijo); el borde cambia de gris a naranja al dibujar.
- Imagen de referencia de fondo al 40% opacity con `object-fit: contain` (aspect preservado — misma geometria que usa el extractor).
- Trazos completados: polyline naranja 70% + marcador inicio azul + marcador fin verde + numero de trazo.
- Trazo actual: polyline naranja opaca + marcador inicio azul.
- Crosshair gris siguiendo el cursor.
- **Debug overlay** (cuando `showGuideDebug`): edges en cian, centroides oscuros, endpoints en naranja 4px con borde blanco.

### Proceso de finalizacion (`handleFinalize`)

1. Combina `strokes` + `currentStroke` (si tiene ≥2 puntos — ese caso adicional corre el adjuster tambien).
2. Por cada trazo ya ajustado:
   - `resample(pts, dotCount)` a N puntos equidistantes
   - Formato `{ coords: [x.toFixed(3), y.toFixed(3)] }`
   - Marca esquinas donde |Δangulo| > π/4
   - `dragger` = primer punto con `toFixed(0)`
3. `strokePaths`: `smooth(pts, 2)` -> path `"d"` con `M` + `L` -> `{ id: 'path{i+1}', d }`
4. Llama `onComplete({ dotList, strokePaths })`

### Conversion de coordenadas

```javascript
toLetterCoords(clientX, clientY) {
  const rect = container.getBoundingClientRect()
  return {
    x: (clientX - rect.left) / SCALE,   // SCALE = 1.4
    y: (clientY - rect.top) / SCALE,
  }
}
```

El contenedor renderiza el hijo scalado via `transform: scale(1.4)` y usa `box-sizing: content-box` para que el border no entre en el tamaño.

### Funciones auxiliares internas

- `resample(points, n)`: misma logica que `pathSampler.js` (longitud acumulada + interpolacion)
- `smooth(points, iterations)`: promedio ponderado 25-50-25, manteniendo extremos

---

## PreviewPage.jsx

Pagina de preview interactivo. **Sin cambios notables** respecto a la version anterior.

### Estado

| Variable | Tipo | Descripcion |
|----------|------|-------------|
| `previewData` | object/null | `{ dataJson, fillSvg, outlineSvg, dottedSvg }` |
| `stepIdx` | number | Indice del trazo actual |
| `dotIdx` | number | Indice del siguiente punto a tocar |
| `mousePos` | `{ x, y }` | Cursor en coordenadas de letra |
| `tracedPath` | array | Puntos tocados del trazo actual |
| `completedStrokes` | array | Paths de trazos anteriores |
| `phase` | `'idle'|'ready'|'tracing'|'done'` | Fase |
| `showFill` | boolean | Mostrar fill SVG al completar |
| `debugMode` | boolean | Debug visual (default `true`) |

### Carga de datos

1. **Desde GeneratorPage**: lee `window.__trazadoPreview` al montar
2. **Upload manual**: carga `data.json` + 3 SVGs via input file

### Conversion de coordenadas

```javascript
screenToLetter(clientX, clientY) {
  const rect = container.getBoundingClientRect()
  x = (clientX - rect.left) / SCALE    // SCALE = 1.4
  y = (clientY - rect.top) / SCALE
}
```

Container con `box-sizing: content-box`.

### Mecanica de trazado

1. **Phase `ready`**: punto de inicio pulsando (azul) en la posicion del `dragger`. Click para comenzar.
2. **Phase `tracing`**: cursor personalizado (circulo naranja). No requiere mantener el mouse presionado.
   - Hit detection: `distancia < max(dotSize, 28)` px al siguiente dot
   - Al tocar un dot: se agrega a `tracedPath`, avanza `dotIdx`
   - Al completar un trazo: se archiva en `completedStrokes`, avanza `stepIdx`, resetea `dotIdx` y `tracedPath`
3. **Phase `done`**: fade-in del fill SVG. Boton "Reiniciar".

### Capas visuales (z-index)

1. `z-index 1`: Fill SVG (solo en `done`) o outline (guia tenue, opacity 0.15)
2. `z-index 2`: Dotted SVG
3. `z-index 5`: SVG overlay con trazos completados (verde), trazo actual (naranja), dots debug
4. `z-index 8`: Punto de inicio pulsante (azul)
5. `z-index 10`: Cursor dragger (naranja)

### Panel de debug

Muestra: phase, step, dot actual, coordenadas del mouse, distancia al target, hit radius, canvas size/scale/dotSize, resumen del `dotList` en JSON.

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
