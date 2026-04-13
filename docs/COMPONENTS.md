# Componentes - Documentacion Detallada

## GeneratorPage.jsx

Componente principal del wizard de generacion de trazados. Es el archivo mas complejo del proyecto (~800 lineas).

### Estado (useState)

| Variable | Tipo | Default | Descripcion |
|----------|------|---------|-------------|
| `mode` | `'font'|'svg'|'manual'` | `'font'` | Modo de generacion seleccionado |
| `font` | object/null | null | Objeto font de opentype.js |
| `fontName` | string | `''` | Nombre del archivo de fuente cargado |
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Tipo de letra |
| `selectedLetters` | string[] | `[]` | Letras seleccionadas para generar |
| `generatedTrazados` | object | `{}` | Map letra -> datos generados |
| `generating` | boolean | false | Flag de generacion en curso |
| `currentStep` | number | 1 | Paso actual del wizard (1-4) |
| `dotCount` | number | 0 | Puntos por trazo (0 = auto: ~1 punto cada 6.5px de longitud) |
| `dotSize` | number | 0 | Tamano visual del punto (0 = auto segun tipo y ancho) |
| `canvasWidth` | number | 380 | Ancho del canvas (380 = auto en modo font) |
| `canvasHeight` | number | 340 | Alto del canvas (340 = auto en modo font) |
| `strokeWidth` | number | 0 | Grosor del trazo de animacion (0 = auto segun tipo) |
| `importedSvgs` | object | `{}` | Map letra -> { fill, outline, dotted } (modo SVG) |
| `audioFiles` | object | `{}` | Map letra -> { es: File, val: File } |
| `imageFiles` | object | `{}` | Map letra -> { character, thum, fondo } |
| `manualDrawings` | object | `{}` | Map letra -> { dotList, strokePaths } (modo manual) |
| `manualActiveLetter` | string/null | null | Letra activa en el drawer manual |
| `refFont` | object/null | null | Fuente de referencia para modo manual |
| `refFontName` | string | `''` | Nombre de la fuente de referencia |

### Persistencia

Todo el estado se persiste en `window.__generatorState` via un `useEffect` sin dependencias (se ejecuta cada render). Al montar, se restaura desde `window.__generatorState` o valores default. El paso actual tambien se lee del URL param `?step=N` via `useSearchParams()`.

### Handlers principales

#### `handleFontUpload(e)`
Carga fuente: `file.arrayBuffer()` -> `parseFont()` -> setFont, setFontName, avanza a paso 2.

#### `handleRefFontUpload(e)`
Carga fuente de referencia para modo manual (mismo proceso, guarda en refFont/refFontName).

#### `getRefSvgs(letter)`
Genera SVGs fill y outline desde la fuente de referencia (o font principal) para usar como guia visual en ManualPathDrawer. Usa `glyphToSvgPathData` -> `generateFillSvg` / `generateOutlineSvg`.

#### `handleManualComplete(letter, result)`
Callback cuando ManualPathDrawer finaliza. Guarda `{ dotList, strokePaths }` en manualDrawings y auto-avanza a la siguiente letra sin dibujo.

#### `generateForLetter(letter)` (CRITICO)
Genera todos los datos de un trazado segun el modo activo. Aplica calculo dinamico de valores.

**Calculo dinamico de valores (modo font)**:
1. **Canvas size**: Si canvasWidth=380 y canvasHeight=340 (defaults), se auto-computa via `computeGlyphCanvasSize(font, char, type)`. Si el usuario ingreso otro valor, se usa ese.
2. **dotSize / strokeWidth**: Si el valor es 0, se auto-computa via `computeLetterParams(letter, type, canvasW)`. Si > 0, se usa el valor del usuario.
3. **dotCount**: Si es 0, se auto-computa por trazo: `extractSkeletonSegments()` -> longitud de cada segmento -> `computeDotCount(length)`. Si > 0, se usa el mismo valor fijo para todos los trazos.

**Modo font**:
1. Calcula canvas size dinamico via `computeGlyphCanvasSize`
2. Calcula dotSize y strokeWidth via `computeLetterParams`
3. Extrae glifo: `glyphToSvgPathData(font, char, w, h)`
4. Para combos (ch, ll): genera cada caracter por separado, calcula anchos individuales via `computeGlyphCanvasSize` y aplica offset horizontal
5. Genera SVGs: fill, outline
6. Genera centerlines: `generateCenterlinePaths(glyphData.d, w, h)`
7. Genera dotted SVG: `generateDottedSvg(centerlines, w, h)`
8. Calcula dotCount por trazo: `extractSkeletonSegments` + `computeDotCount` por segmento
9. Samplea puntos: `samplePathPointsMultiStroke(glyphData.d, dotCountArray, dotSize, w, h)` — dotCountArray es un array con un valor por trazo

**Modo SVG**:
1. Usa SVGs importados directamente
2. Si hay dotted SVG: extrae paths y samplea puntos con `samplePathPoints`
3. Si solo hay fill: extrae path, usa `samplePathPointsMultiStroke`

**Modo manual**:
1. Usa dotList y strokePaths del manualDrawings
2. Genera fill/outline desde fuente de referencia (o vacios)
3. Genera dotted SVG desde strokePaths

Retorno: `{ letter, folderName, fillSvg, outlineSvg, dottedSvg, dataJson, dotList, audioEs, audioVal, characterImg, thumImg, fondoImg, computedValues }`
- `computedValues`: `{ canvasW, canvasH, dotSize, strokeWidth, dotCounts }` — valores realmente usados (utiles para Step 4 UI)

#### `handleGenerate()`
Loop sobre selectedLetters, llama generateForLetter para cada una, guarda en generatedTrazados, avanza a paso 4.

#### `handlePreview(letter)`
Almacena datos en `window.__trazadoPreview` y navega a `/preview`.

#### `handleExportSingle(letter)` / `handleExportAll()`
Exportan como ZIP individual o masivo.

### UI por Paso

**Paso 1**: Selector de modo (3 botones), area de carga de fuente/SVG/manual
**Paso 2**: Selector ligada/mayusculas, grid de letras con toggle
**Paso 3**: Panel de configuracion (5 inputs, siempre habilitados). Info box explica que 0 = auto-compute. Labels muestran "(auto si se deja en 0/380/340)". Area especifica por modo (SVG import, manual drawer), boton generar.
**Paso 4**: Lista de trazados generados mostrando valores computados por letra (canvas size, dotSize, stroke, num trazos, puntos por trazo). Preview/export individual, uploads de assets, export masivo.

---

## PreviewPage.jsx

Pagina de preview interactivo que simula el trazado real.

### Estado

| Variable | Tipo | Descripcion |
|----------|------|-------------|
| `previewData` | object/null | `{ dataJson, fillSvg, outlineSvg, dottedSvg }` |
| `stepIdx` | number | Indice del trazo actual (0-based) |
| `dotIdx` | number | Indice del siguiente punto a tocar |
| `mousePos` | `{ x, y }` | Posicion del cursor en coordenadas de letra |
| `tracedPath` | array | Puntos ya tocados del trazo actual |
| `completedStrokes` | array | Paths completados de trazos anteriores |
| `phase` | `'idle'|'ready'|'tracing'|'done'` | Fase actual |
| `showFill` | boolean | Mostrar fill SVG al completar |
| `debugMode` | boolean | Modo debug (default true) |

### Carga de datos

1. **Desde GeneratorPage**: Lee `window.__trazadoPreview` al montar
2. **Upload manual**: Carga archivos data.json + SVGs via input file

### Conversion de coordenadas

```javascript
screenToLetter(clientX, clientY) {
  const rect = container.getBoundingClientRect()
  x = (clientX - rect.left) / SCALE    // SCALE = 1.4
  y = (clientY - rect.top) / SCALE
}
```

El container tiene `box-sizing: content-box` para que el border no afecte las dimensiones.

### Mecanica de trazado

1. **Phase 'ready'**: Muestra punto de inicio pulsando (azul). Click para comenzar.
2. **Phase 'tracing'**: Cursor personalizado (circulo naranja). Mover el cursor por los puntos.
   - No requiere mantener el boton del mouse presionado
   - Hit detection: `distancia < max(dotSize, 28)` px
   - Al tocar un punto: se agrega a tracedPath, avanza dotIdx
   - Al completar un trazo: se archiva en completedStrokes, avanza stepIdx
3. **Phase 'done'**: Fade-in del fill SVG. Boton reiniciar.

### Capas visuales (z-index)

1. `z-index 1`: Fill SVG (solo en 'done') o outline (guia tenue, opacity 0.15)
2. `z-index 2`: Dotted SVG
3. `z-index 5`: SVG overlay con trazos completados (verde), trazo actual (naranja), puntos debug
4. `z-index 8`: Punto de inicio pulsante (azul)
5. `z-index 10`: Cursor dragger (naranja)

### Panel de debug

Muestra: phase, step, dot actual, coordenadas del mouse, distancia al target, hit radius, resumen de dotList en JSON.

---

## ManualPathDrawer.jsx

Componente para dibujar trazados manualmente con el cursor.

### Props

| Prop | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `letter` | string | `''` | Letra que se esta dibujando |
| `type` | `'ligada'|'mayusculas'` | `'ligada'` | Tipo para mostrar display correcto |
| `fillSvg` | string | `''` | SVG fill como guia visual (opacity 0.08) |
| `outlineSvg` | string | `''` | SVG outline como guia visual (opacity 0.2) |
| `width` | number | 380 | Ancho del canvas en unidades de letra |
| `height` | number | 340 | Alto del canvas en unidades de letra |
| `dotCount` | number | 40 | Puntos por trazo al resamplear |
| `dotSize` | number | 33 | dotSize para data.json |
| `onComplete` | function | - | Callback con `{ dotList, strokePaths }` |
| `onCancel` | function | - | Callback al cancelar |

### Estado interno

- `isDrawing` (boolean): Si hay un trazo en curso
- `strokes` (Array<Array<{x,y}>>): Trazos completados
- `currentStroke` (Array<{x,y}>): Puntos del trazo actual
- `cursorPos` ({x,y}/null): Posicion del cursor

### Mecanica de dibujo

1. **Mouse-down**: Inicia un nuevo trazo, registra primer punto
2. **Mouse-move**: Si isDrawing, agrega puntos (filtro: minimo 1.5px de distancia)
3. **Mouse-up**: Finaliza el trazo actual si tiene >= 2 puntos, lo agrega a strokes
4. **Click nuevo**: Inicia otro trazo (multi-stroke)
5. **Touch**: Mismo comportamiento

### Atajos de teclado

| Tecla | Accion |
|-------|--------|
| `N` | Forzar fin del trazo actual |
| `Ctrl+Z` | Deshacer ultimo trazo |
| `Enter` | Finalizar y guardar |
| `Escape` | Limpiar todo |

### Visualizacion

- Canvas con borde que cambia de color al dibujar (gris -> naranja)
- Guia: fill SVG muy tenue (8% opacity) + outline (20% opacity)
- Trazos completados: polyline naranja, marcador inicio azul, fin verde, numero de trazo
- Trazo actual: polyline naranja + marcador inicio azul
- Crosshair personalizado en posicion del cursor
- Lista de trazos debajo con info de puntos e inicio/fin

### Proceso de finalizacion (handleFinalize)

1. Reune todos los trazos (completados + actual si tiene >= 2 puntos)
2. Por cada trazo:
   a. Resamplea a `dotCount` puntos equidistantes
   b. Convierte a formato `{ coords: [x, y] }`
   c. Detecta esquinas (angulo > 45 grados)
   d. Calcula dragger desde primer punto
3. Construye strokePaths: suaviza cada trazo (2 iteraciones), convierte a SVG path "d"
4. Llama `onComplete({ dotList, strokePaths })`

### Conversion de coordenadas

```javascript
toLetterCoords(clientX, clientY) {
  const rect = container.getBoundingClientRect()
  return {
    x: (clientX - rect.left) / SCALE,  // SCALE = 1.4
    y: (clientY - rect.top) / SCALE,
  }
}
```

### Funciones auxiliares internas

- `resample(points, n)`: Misma logica que pathSampler.js
- `smooth(points, iterations)`: Misma logica que pathSampler.js

---

## App.jsx

Layout principal con navegacion (React Router).

### Rutas

| Path | Componente | Descripcion |
|------|-----------|-------------|
| `/` | HomePage | Landing page |
| `/generator` | GeneratorPage | Wizard generador |
| `/preview` | PreviewPage | Preview interactivo |

### Navegacion

Header con links: Inicio, Generador, Preview. Usa NavLink para estilo activo.

---

## HomePage.jsx

Landing page simple con:
- Titulo y descripcion del proyecto
- Botones para ir a Generador y Preview
- Grid de 4 feature cards (Tipografia, SVG, Preview, Exportacion)
