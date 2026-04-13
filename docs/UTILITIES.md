# Utilidades - Documentacion Tecnica

## fontParser.js

Modulo para parsear fuentes tipograficas y extraer glifos como paths SVG.

### Dependencia
- `opentype.js` v1.3.4

### Funciones exportadas

#### `parseFont(arrayBuffer)`
Parsea un archivo de fuente desde un ArrayBuffer.
- **Input**: `ArrayBuffer` del archivo .ttf/.otf/.woff
- **Output**: Objeto font de opentype.js
- **Uso**: `const font = parseFont(await file.arrayBuffer())`

#### `computeGlyphCanvasSize(font, char, type, padding)` *(NUEVO)*
Calcula las dimensiones naturales del canvas para un glifo, manteniendo su aspect ratio.
- **Params**:
  - `font`: Objeto font de opentype.js
  - `char`: Caracter a medir
  - `type`: `'ligada'` | `'mayusculas'`
  - `padding`: Padding interno (default 20)
- **Output**: `{ width: number, height: number }`
- **Logica**:
  - Altura base: 340px para ligada, 315px para mayusculas
  - Escala el glifo para llenar la altura disponible (menos padding)
  - Calcula ancho = glifo escalado + padding × 2
  - Minimo 80px de ancho

#### `glyphToSvgPathData(font, char, targetWidth, targetHeight, padding)`
Extrae un glifo y lo convierte a un path SVG escalado y centrado.
- **Params**:
  - `font`: Objeto font de opentype.js
  - `char`: Caracter a extraer (ej: `'a'`, `'A'`)
  - `targetWidth`: Ancho del canvas destino (default 300)
  - `targetHeight`: Alto del canvas destino (default 300)
  - `padding`: Padding interno en px (default 20)
- **Output**: `{ d, width, height, scale, offsetX, offsetY, bbox }`
  - `d`: String del atributo "d" del path SVG, ya transformado
  - `bbox`: Bounding box del glifo transformado `{ x, y, w, h }`
- **Proceso**: Renderiza a fontSize=300, calcula escala para encajar en target manteniendo aspect ratio, aplica offset para centrar, transforma cada comando SVG (M, L, Q, C, Z)

#### `getAvailableChars(font)`
Lista todos los caracteres disponibles en la fuente.
- **Output**: Array de strings con caracteres Unicode >= 32

---

## pathSampler.js (CRITICO - Algoritmo principal)

Modulo que extrae la linea central (esqueleto) de una letra y genera las coordenadas de los puntos de trazado.

**Version 2** — Mejoras respecto a v1:
- Rasterizacion a 2× resolucion (`RASTER_SCALE = 2`) para esqueletos mas suaves
- Suavizado de 4 iteraciones ANTES del resampleo (elimina zigzag pixel a pixel)
- Merge de segmentos casi colineales (angulo < 30°) que fueron sobre-divididos en junctions
- Filtrado de segmentos muy cortos (< 8% del mas largo) como ruido
- SVG paths con curvas Bezier cuadraticas en lugar de lineas rectas

### Pipeline completo

```
SVG path "d" string
    |
    v
skeletonize()                  --> Rasteriza a 2× + Zhang-Suen thinning
    |
    v
splitSkeletonAtJunctions()     --> Detecta junctions, separa en segmentos
    |
    v
mergeCollinearSegments()       --> Fusiona segmentos casi rectos (< 30°)
    |
    v
filterShortSegments()          --> Elimina ruido (< 8% del mas largo)
    |
    v
orientAndOrderSegments()       --> Orienta cada segmento y ordena globalmente
    |
    v
smoothPoints(4 iter)           --> Suaviza antes de resamplear
    |
    v
resamplePath()                 --> Remuestrea a N puntos equidistantes
    |
    v
markCorners()                  --> Marca puntos con cambio de direccion > 45°
```

### Funciones exportadas

#### `extractSkeletonSegments(pathD, width, height)` *(NUEVO)*
Extrae los segmentos del esqueleto ya suavizados y sus longitudes.
- **Output**: `{ segments: Array<Array<{x,y}>>, lengths: Array<number> }`
- **Uso**: Se usa en GeneratorPage para calcular `computeDotCount()` por trazo

#### `samplePathPointsMultiStroke(pathD, numPointsPerStroke, dotSize, width, height)`
Funcion principal. Retorna un array de trazos con sus puntos.
- **Input**: Path SVG "d" string, parametros de configuracion
  - `numPointsPerStroke` puede ser un numero (igual para todos) o un Array de numeros (uno por trazo)
- **Output**: `Array<{ dragger: [x, y], coordinates: Array<{ coords: [x, y], corner?: boolean }> }>`
- **Proceso**:
  1. Esqueletoniza el path SVG a 2× resolucion
  2. Divide el esqueleto en segmentos en los puntos de junction
  3. Merge de segmentos colineales y filtrado de ruido
  4. Orienta cada segmento segun la direccion natural de escritura
  5. Suaviza con 4 iteraciones
  6. Remuestrea a N puntos (variable por trazo si se pasa array)
  7. Marca esquinas
  8. Filtra segmentos con < 3 puntos

#### `samplePathPoints(pathD, numPoints, dotSize, width, height)`
Version retrocompatible que retorna solo el primer trazo.
- **Output**: `{ dragger: [x, y], coordinates: [...] }`

#### `generateCenterlinePaths(pathD, width, height)`
Genera paths SVG de la linea central para el letter-dotted.svg.
- **Output**: `Array<{ id: string, d: string }>` (ej: `[{ id: 'path1', d: 'M...' }]`)
- **Proceso**: Esqueletoniza, divide, merge, filtra, orienta, suaviza con 5 iteraciones, convierte a SVG path con curvas Bezier cuadraticas

#### `extractPathsFromSvg(svgString)`
Extrae paths "d" y viewBox de un string SVG.
- **Output**: `{ paths: Array<{ id, d }>, width, height }`

### Constantes de configuracion

| Constante | Valor | Descripcion |
|-----------|-------|-------------|
| `RASTER_SCALE` | 2 | Factor de resolucion para rasterizacion (2× = 760×680 para un canvas 380×340) |
| `MIN_SEGMENT_RATIO` | 0.08 | Segmentos menores al 8% del mas largo se descartan |

### Algoritmos internos

#### Zhang-Suen Thinning (`zhangSuenThin`)
Algoritmo de esqueletonizacion (thinning) iterativo en dos sub-pasos.
Opera sobre el grid de alta resolucion (2×).

1. Rasteriza el path SVG en un canvas invisible a RASTER_SCALE× resolucion
2. Escala el contexto con `ctx.scale(RASTER_SCALE, RASTER_SCALE)` antes de fill
3. Convierte a grid binario (alpha > 128 = 1, sino 0)
4. Itera removiendo pixels del borde hasta que solo queda el esqueleto (1 pixel de ancho)
5. Coordenadas resultantes se dividen por RASTER_SCALE para volver a letter-space

```
Numeracion de vecinos N8:
  7  0  1
  6  X  2
  5  4  3
```

#### Junction Detection (`splitSkeletonAtJunctions`)
Opera en raster-space (alta resolucion) y retorna segmentos en letter-space.

Clasifica cada pixel del esqueleto:
- **ENDPOINT** (1 vecino): extremo de una rama
- **NORMAL** (2 vecinos): pixel de paso
- **JUNCTION** (3+ vecinos): punto de ramificacion

Proceso:
1. Clasificar todos los pixels
2. Remover pixels JUNCTION del grid para desconectar ramas
3. Trazar cada componente conectado como un segmento ordenado
4. Re-adjuntar coordenadas de junction a los extremos mas cercanos de cada segmento (distancia <= 3px)
5. Convertir coordenadas de raster-space a letter-space (÷ RASTER_SCALE)

#### Merge de Segmentos Colineales (`mergeCollinearSegments`)
Cuando un junction divide un trazo que era continuo (ej: una linea recta cruzando una interseccion), lo fusiona.

Para cada par de segmentos:
1. Busca extremos cercanos (< 4px Manhattan distance)
2. Calcula vectores de direccion en los ultimos 6 puntos de cada extremo
3. Si el angulo entre ellos < 30° (PI/6), los fusiona
4. Repite hasta que no hay mas merges posibles

#### Filtrado de Segmentos Cortos (`filterShortSegments`)
Calcula la longitud acumulada de cada segmento y descarta los que son < 8% del segmento mas largo. Siempre mantiene al menos 1 segmento.

#### Stroke Orientation (`orientAndOrderSegments`)
Para cada segmento decide la direccion:
- **Vertical/diagonal** (deltaY > deltaX * 0.5): Inicio en el punto mas ARRIBA (menor Y)
- **Horizontal** (deltaY <= deltaX * 0.5): Inicio en el punto mas a la IZQUIERDA (menor X)

Ordenacion global: topmost first (menor Y), tie-break leftmost (menor X), tolerancia 5px.

#### Tracing (`traceConnected`)
Sigue una cadena de pixels conectados usando "greedy neighbor-following":
- Comienza en un pixel (preferiblemente endpoint)
- En cada paso, elige el vecino no visitado cuya direccion sea mas consistente con la direccion actual (producto punto)
- Termina cuando no hay vecinos no visitados

#### Resampling (`resamplePath`)
Distribuye N puntos equidistantes a lo largo del camino:
1. Calcula longitud acumulada del camino
2. Divide la longitud total en N-1 intervalos iguales
3. Interpola linealmente entre puntos originales para cada posicion target

#### Smoothing (`smoothPoints`)
Suaviza los puntos con promedio ponderado iterativo:
- Peso: prev 25% + curr 50% + next 25%
- Mantiene primer y ultimo punto sin cambio
- 4 iteraciones para dotList, 5 para centerline SVG paths

#### SVG Path Conversion (`pointsToSvgPath`)
Convierte puntos a un SVG path "d" string usando curvas Bezier cuadraticas (Q) a traves de midpoints para mayor suavidad, en lugar de lineas rectas (L).

#### Corner Detection (`markCorners`)
Para cada punto intermedio:
1. Calcula angulo de entrada (punto anterior -> actual)
2. Calcula angulo de salida (actual -> siguiente)
3. Si la diferencia absoluta > PI/4 (45 grados), marca `corner: true`

---

## svgGenerator.js

Genera los tres tipos de SVG necesarios.

### Funciones exportadas

#### `generateFillSvg(pathD, width, height)`
- Genera `letter-fill.svg`
- Path con `id="fill"` y `style="fill-rule:nonzero;"`

#### `generateOutlineSvg(pathD, width, height, strokeWidth)`
- Genera `letter-outline.svg`
- Path con `id="contorno"` y estilo de contorno sin relleno
- `strokeWidth` default: 3

#### `generateDottedSvg(strokePaths, width, height)`
- Genera `letter-dotted.svg`
- Input: `Array<{ id, d }>` - paths de la linea central
- Grupo contenedor con `id="path"`
- Cada path con `id="path1"`, `id="path2"`, etc.
- `stroke-dasharray: 0.1,16` para efecto punteado

---

## dataGenerator.js

Genera el data.json, maneja nomenclatura y computa valores dinamicos.

### Funciones exportadas

#### `generateDataJson({ letter, type, letterSize, dotList, animationPaths, animationPathStroke, dotSize })`
Construye el objeto data.json completo.

**Logica del campo `letter`**:
- Ligada: `letter.toLowerCase()` -> `"a"`, `"ch"`, `"ll"`, `"ny"`
- Mayusculas: `"Upper" + capitalize(letter)` -> `"UpperA"`, `"UpperCh"`, `"UpperLl"`

**Calculo de `time` en animationPaths**:
- `Math.max(2, Math.round(length / 50))` - minimo 2 segundos

#### `getFolderName(letter, type)`
Genera nombre de carpeta.
- Caracteres especiales: n -> `ny`, ch y ll se mantienen
- Ligada: `trazado-letra-{base}`
- Mayusculas: `trazado-letra-{base}-mayus`

#### `computeLetterParams(letter, type, canvasW)` *(NUEVO)*
Computa dotSize y animationPathStroke recomendados para una letra, basado en los patrones del proyecto existente.

- **Input**: letra, tipo, ancho del canvas
- **Output**: `{ dotSize: number, animationPathStroke: number }`
- **Logica mayusculas**: dotSize 34 (40 si ancho > 240), stroke 10 (12 si ancho > 350)
- **Logica ligada**: Basado en ancho del canvas (28-38) con overrides especificos para e, i, k, m, n, u, p

#### `computeDotCount(pathLengthPx)` *(NUEVO)*
Calcula la cantidad recomendada de puntos para un trazo segun su longitud.
- **Formula**: `round(pathLengthPx / 6.5)`, clamped a [3, 90]
- **Ratio**: ~1 punto cada 6.5 px de longitud de trazo

### Constantes exportadas

- `SPANISH_LETTERS`: Array de 27 letras del abecedario espanol (a-z + n)
- `SPECIAL_COMBOS`: `['ch', 'll']`

---

## exportUtils.js

Exportacion de trazados como ZIP.

### Dependencias
- `JSZip` - generacion de ZIP
- `file-saver` - descarga del blob

### Funciones exportadas

#### `exportTrazado(trazadoData, options)`
Crea un ZIP con todos los archivos de un trazado individual.
- Retorna `{ zip, folder }` (instancia JSZip)
- Crea placeholders automaticos para assets no proporcionados

#### `exportAllTrazados(trazadosList, baseType)`
Exporta multiples trazados en un solo ZIP agrupados bajo `ligada/` o `mayusculas/`.
- Descarga automaticamente como `trazados-{baseType}.zip`

#### `downloadSingleTrazado(trazadoData)`
Wrapper de conveniencia: crea ZIP y descarga.

### Placeholders generados

- **createSilentMp3()**: 32 bytes, header MPEG1 Layer 3 valido
- **createPlaceholderPng()**: PNG 1x1 transparente desde base64
