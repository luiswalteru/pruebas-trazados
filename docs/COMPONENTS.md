# Componentes - Documentacion Detallada

> **Contexto (abril 2026)**: Tras el refactor manual-only, `GeneratorPage` se simplifico considerablemente. Los modos `font`/`svg`, los uploads de assets (audio/imagenes) y todo el pipeline de `pathSampler` desaparecieron de la UI.

## GeneratorPage.jsx

Componente principal del wizard de generacion de trazados. Reducido drasticamente respecto a la version anterior (ya no orquesta tres modos distintos).

### Estado (useState)

| Variable | Tipo | Default | Descripcion |
|----------|------|---------|-------------|
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Tipo de letra |
| `selectedLetters` | string[] | `[]` | Array de **a lo sumo una** letra (la seleccion es exclusiva) |
| `generatedTrazados` | object | `{}` | Map letra -> datos generados |
| `generating` | boolean | `false` | Flag de generacion en curso |
| `currentStep` | number | 1 | Paso actual del wizard (1-4) |
| `dotCount` | number | 0 | Puntos por trazo al resamplear el dibujo (0 permitido, pero el manual-drawer usa su default 40 si viene 0) |
| `dotSize` | number | 0 | 0 = auto via `computeLetterParams`, >0 = forzado |
| `canvasWidth` | number | 380 | Ancho del canvas (el usuario lo configura, ya no hay auto) |
| `canvasHeight` | number | 340 | Alto del canvas |
| `strokeWidth` | number | 0 | 0 = auto via `computeLetterParams`, >0 = forzado |
| `manualDrawings` | object | `{}` | Map letra -> `{ dotList, strokePaths }` |
| `manualActiveLetter` | string/null | `null` | Letra activa en el drawer |
| `refFont` | object/null | `null` | Fuente de referencia opcional (guia visual) |
| `refFontName` | string | `''` | Nombre del archivo de fuente de referencia |

**Ya no existen** (vs version anterior): `mode`, `font`, `fontName`, `importedSvgs`, `audioFiles`, `imageFiles`.

### Persistencia

Todo el estado se vuelca a `window.__generatorState` en un `useEffect` sin array de dependencias (corre en cada render). Al montar se restaura desde `window.__generatorState` o valores default. El paso actual se lee de `?step=N` o del estado persistido.

### Handlers principales

#### `toggleLetter(letter)`
Selecciona **una sola** letra. Si se hace click en la misma letra ya seleccionada, se deselecciona. Si se hace click en otra, reemplaza la seleccion actual.

#### `handleRefFontUpload(e)`
Carga la fuente de referencia opcional. Parsea con `parseFont` y guarda en `refFont` / `refFontName`.

#### `getRefSvgs(letter)`
Genera `fillSvg`, `outlineSvg` y `fillPathD` para una letra usando la fuente de referencia. Retorna strings vacios si no hay `refFont`. Usado tanto como guia visual en el drawer como para el export final.

#### `handleManualComplete(letter, result)`
Callback al terminar un dibujo. Guarda `{ dotList, strokePaths }` en `manualDrawings` y auto-avanza a la siguiente letra sin dibujo.

#### `generateForLetter(letter)` (CRITICO)
Unico path de generacion (ya no hay branches font/svg/manual):

1. Lee `manualDrawings[letter]` — error si no existe
2. Usa `canvasWidth` / `canvasHeight` tal cual
3. Calcula `effDotSize` / `effStroke` via override 0/>0 + `computeLetterParams`
4. `getRefSvgs(letter)` — fill/outline desde la fuente si hay, fallback a `generateFillSvgFromStrokes` / `generateOutlineSvgFromStrokes` si no
5. `generateDottedSvg(dotList, w, h, max(4, round(effDotSize/4)))` — circulos por coordenada
6. `animationPaths`: por cada stroke, `{ length: coordinates.length, time: max(2, round(length/4)) }`
7. Construye `data.json` via `generateDataJson`

Retorno: `{ letter, folderName, fillSvg, outlineSvg, dottedSvg, dataJson, dotList, strokePaths, fillPathD }`. `strokePaths` y `fillPathD` se usan luego en `thumGenerator` al exportar.

#### `handleGenerate()` / `handleExportSingle(letter)` / `handleExportAll()`
Generar todas las letras seleccionadas, exportar individual/masivo.
Ojo: `handleExportSingle` y `handleExportAll` son ahora `async` (porque el export genera `thum.png`).

#### `handlePreview(letter)`
Coloca `{ dataJson, fillSvg, outlineSvg, dottedSvg }` en `window.__trazadoPreview` y navega a `/preview`.

### UI por Paso

- **Paso 1 — Inicio**: Texto introductorio + boton "Cargar fuente de referencia (opcional)" + "Siguiente". **Sin selector de modo**.
- **Paso 2 — Letras**: Toggle ligada/mayusculas + grid de letras (seleccion exclusiva — una sola). Contador indica la letra activa.
- **Paso 3 — Configurar y generar**: Inputs (canvas w/h, dotCount, dotSize, strokeWidth). Pestañas por letra seleccionada + `ManualPathDrawer` activo. Boton "Generar N trazado(s)".
- **Paso 4 — Assets y exportacion**: Lista de trazados generados con valores computados (canvas, dotSize, stroke, trazos, puntos por trazo). Botones `Preview` / `Exportar` por item + `Exportar todos como ZIP` global. **Ya no hay uploads** de audio/imagen.

---

## ManualPathDrawer.jsx

Canvas de dibujo manual. Produce `{ dotList, strokePaths }` al finalizar.

### Props

| Prop | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `letter` | string | `''` | Letra que se esta dibujando (para display) |
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Display |
| `fillSvg` | string | `''` | SVG fill como guia visual (opacity 8%) Y **fuente de la mascara** para `snapToCenterline` |
| `outlineSvg` | string | `''` | SVG outline como guia visual (opacity 20%) |
| `width`, `height` | number | 380, 340 | Dimensiones del canvas en unidades de letra |
| `dotCount` | number | 40 | Puntos por trazo al resamplear |
| `dotSize` | number | 33 | Solo informativo (no afecta el dibujo) |
| `onComplete` | function | - | Callback con `{ dotList, strokePaths }` |
| `onCancel` | function | - | Callback al cancelar |

### Estado interno

- `isDrawing` (boolean): si hay trazo en curso
- `strokes` (Array<Array<{x,y}>>): trazos completados
- `currentStroke` (Array<{x,y}>): puntos del trazo actual
- `cursorPos` ({x,y}/null): para dibujar el crosshair
- `maskRef` (ref): resultado de `buildLetterMask(fillSvg, width, height)` — se reconstruye cuando cambia `fillSvg`

### Pipeline de captura (NUEVO — april 2026)

El punto crudo del cursor no se usa tal cual. Cada movimiento pasa por:

1. **EMA con el punto anterior** (`SMOOTH_ALPHA = 0.5`): filtro pasa-bajos contra jitter de mano.
2. **Gate de distancia minima** (`1.2 px` desde el ultimo guardado): evita sobre-muestreo.
3. **`snapToCenterline`** contra la mascara de `fillSvg`: empuja al punto hacia el eje medial de la letra via gradiente del distance field. Si no hay `fillSvg` (es decir, no se cargo fuente de referencia) es un no-op.

Esto se hace **en tiempo real mientras el usuario dibuja** — los puntos que se van acumulando en `currentStroke` ya estan centrados y suavizados.

### Mecanica de dibujo

1. **Mouse-down**: Inicia trazo, registra primer punto (ya pasado por `snapToCenterline`)
2. **Mouse-move**: Si `isDrawing`, aplica pipeline y agrega al trazo
3. **Mouse-up**: Finaliza si el trazo tiene ≥ 2 puntos
4. **Click nuevo**: Inicia otro trazo (multi-stroke)
5. **Touch**: Mismo comportamiento

### Atajos de teclado

| Tecla | Accion |
|-------|--------|
| `N` | Forzar fin del trazo actual |
| `Ctrl+Z` / `Cmd+Z` | Deshacer ultimo trazo |
| `Enter` | Finalizar y guardar |
| `Escape` | Limpiar todo |

### Visualizacion

- Canvas con borde que cambia de color al dibujar (gris -> naranja)
- Guia: fill SVG muy tenue (8%) + outline (20%)
- Trazos completados: polyline naranja (opacity 70%), marcador inicio azul, fin verde, numero de trazo como texto
- Trazo actual: polyline naranja opaca + marcador inicio azul
- Crosshair gris siguiendo al cursor (opacity 40%)
- Badge "Auto-centrado activo" en verde si hay `fillSvg` (es decir, hay mascara)
- Lista de trazos debajo con info de puntos e inicio/fin

### Proceso de finalizacion (`handleFinalize`)

1. Combina `strokes` + `currentStroke` (si tiene ≥ 2 puntos)
2. Por cada trazo:
   - `resample(pts, dotCount)` a N puntos equidistantes
   - Formato `{ coords: [x.toFixed(3), y.toFixed(3)] }`
   - Marca esquinas donde |Δangulo| > π/4
   - `dragger` = primer punto con `toFixed(0)`
3. Construye `strokePaths`: `smooth(pts, 2)` -> path `"d"` con comandos `M` y `L` -> `{ id: 'path{i+1}', d }`
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

Landing page simple:
- Hero con titulo y subtitulo que explicita dibujo manual (*"dibujando el recorrido manualmente con el cursor"*)
- Botones: "Comenzar a Generar" → `/generator`, "Ver Preview" → `/preview`
- **3 feature cards** (antes habia 4 — las de "Tipografia" y "SVG" se eliminaron):
  1. Trazado Manual
  2. Preview Interactivo
  3. Exportacion Completa
