# Formatos de Datos - Schemas y Estructuras

## Bundle exportado por letra

El generador produce exactamente dos archivos por letra:

```
trazado-letra-{nombre}/
  data.json
  base.svg
```

`base.svg` (ilustración) y `guia.svg` (punteado) se suben en el Paso 1 y **no** se re-emiten en el ZIP — los autora el pipeline de contenido aparte. Nota: el `base.svg` subido comparte nombre con el `base.svg` que emitimos (la plantilla animable), pero son ficheros distintos: la ilustración es solo backdrop del dibujo, la plantilla es el SVG con los `<path>` animables del reader. Tampoco hay `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `thum.png`, `character.png` ni audios: ninguno se genera desde este refactor.

---

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
  "letterSize": [380, 340],
  "animationPathStroke": 16,
  "letterAnimationPath": [
    { "selector": "#path1", "time": 10 },
    { "selector": "#path2", "time": 8 }
  ],
  "dotSize": 33,
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

El shape coincide con `ejemplo/trazado-letra-a/data.json`, que es la referencia canonica que lee el reader.

### Campos clave

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `letter` | string | Identificador. Ligada: `"a"`, `"b"`, `"ch"`, `"ll"`, `"ñ"`. Mayusculas: `"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"` (ver nota abajo) |
| `letterSize` | `[width, height]` | Dimensiones del canvas. Siempre el valor configurado por el usuario en el Paso 2 (default 380×340) |
| `animationPathStroke` | number | Grosor del trazo de animacion. **Fijo en 16** via `computeLetterParams` para que coincida con `stroke-width="16"` de la referencia `ejemplo/trazado-letra-a/base.svg`. El usuario puede forzar otro valor desde el input `strokeWidth` del Paso 2 |
| `letterAnimationPath` | array | Selectores CSS (`#path1`, `#path2`, ...) que apuntan a los `<path>` dentro de `base.svg`, con su tiempo de animacion |
| `dotSize` | number | Tamano visual de cada punto. Auto: ligada 26–40, mayusculas 34–40 via `computeLetterParams`. O forzado por el usuario |
| `playButtonPosition` | `[x, y]` | Posicion relativa del boton play — constante `[-20, 30]` |
| `dotList` | array | Array de trazos. Cada trazo tiene `dragger` y `coordinates` |

### Nota sobre los pointers a assets externos

Los campos `character`, `letterFill`, `letterOutline`, `letterDotted`, y `title.audio.{es,val}` apuntan a archivos que **esta herramienta no produce** — los aporta el pipeline de contenido aparte (audios, ilustraciones, SVG de fill/outline/dotted pre-generados). Los pointers se mantienen en `data.json` porque el reader los lee: el shape del JSON tiene que coincidir con `ejemplo/trazado-letra-a/data.json` para que el reader renderice correctamente el trazado.

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

- **`dragger`**: Coordenadas enteras `[x, y]` donde el reader posiciona la **esquina superior-izquierda** del `#fixedDot` (un `div` de 20×20 px colocado con `transform: translate(x px, y px)`). Se calcula como `(resampled[0].x − 10, resampled[0].y − 10)` para que el centro visual del div caiga sobre el primer punto del trazo. Sin esta resta, el fixedDot aparece 10 px abajo-a-la-derecha del inicio del trazo (bug visible al finalizar la animación en el reader)
- **`coordinates`**: Array de puntos que forman el recorrido del trazo
  - `coords`: Array `[x, y]` con 3 decimales, en espacio de letra (px del canvas)
  - `corner` (opcional): `true` si el punto es una esquina/cambio de direccion (angulo > 45°)

### Generacion del dotList

`ManualPathDrawer.handleFinalize` construye el dotList asi:

1. Toma los trazos dibujados (arrays crudos de `{x, y}` ya filtrados por distancia minima y suavizados por EMA, y proyectados al soltar sobre el esqueleto de `guia.svg` via `projectStrokeOnGuide`).
2. Por cada trazo: `resample` a `dotCount` puntos equidistantes.
3. Aplica `toFixed(3)` a cada `coords`.
4. Marca esquinas con `corner: true` (diferencia de angulo entrada/salida > π/4).
5. Extrae `dragger` del primer punto resampleado, restando `(10, 10)` para centrar el `#fixedDot` (20×20 px) del reader sobre el punto de inicio; luego `toFixed(0)`.

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

El indice de cada `dotList[i]` corresponde al selector `#path{i+1}` en `letterAnimationPath`, que a su vez apunta al `<path id="path{i+1}">` dentro de `base.svg`.

El campo `time` lo calcula `GeneratorPage.generateForLetter` como `Math.max(2, Math.round(coordinates.length / 4))` y lo pasa a `generateDataJson`, que prioriza `p.time` si viene (caida a `Math.max(2, round(length / 50))` si no).

---

## base.svg

Template SVG que replica la estructura de los componentes `LetterX` en `ejemplo/letters.js`. Lo consume el reader: hace `fetch` del archivo como texto y lo inyecta en un `<div style={{height:340}}>` via `dangerouslySetInnerHTML`, luego anima los `<path>` con `stroke-dasharray` + `stroke-dashoffset`; `#circle` es el marcador arrastrable del punto inicial; `#letterBg` el fondo clickable.

```xml
<svg class="svg-letter" width="100%" height="100%" viewBox="0 0 380 340">
  <rect id="letterBg" x="0" y="0" width="380" height="340"/>
  <path id="path1" class="svgPath" stroke="#f04e23" fill="none" stroke-width="16" d="M..."/>
  <path id="path2" class="svgPath" stroke="#f04e23" fill="none" stroke-width="16" d="M..."/>
  <circle id="circle" cx="190" cy="85" r="12" fill="blue"/>
</svg>
```

**Contrato**:

- **Sin XML prolog ni DOCTYPE.** El reader hace `innerHTML` de este fichero dentro de un `<div>` — un `<?xml ... ?>` o DOCTYPE externo dentro de un `<div>` es HTML invalido: el parser los convierte en comentario bogus y las reglas CSS (`.svg-letter .svgPath`) no aplican, dejando los paths con `fill:black` por defecto (la letra sale en negro). Se emite el mismo shape bare `<svg>` que React renderiza desde `letters.js`.
- Un `<path id="path{i+1}" class="svgPath" stroke="#f04e23" fill="none" stroke-width="S">` por trazo del usuario. `d` es `strokePaths[i].d` construido por `ManualPathDrawer.handleFinalize` como `M x,y L x,y ...` sobre los puntos suavizados con `smooth(_, 2)` (antes del resample).
- `stroke-width="S"` se embebe como numero concreto (`effStroke` = `animationPathStroke` de `data.json`, **fijo en 16** salvo override del usuario). En los componentes JSX de `letters.js` este valor llega por prop `stroke`; aqui esta baked-in para que el archivo se pueda servir estatico.
- `stroke="#f04e23"` y `fill="none"` inline como **fallbacks de atributo de presentacion**: la regla CSS del reader (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`) tiene mayor especificidad y sobreescribe, pero si no carga, los atributos inline evitan que el path salga negro o sin color.
- `<circle id="circle" cx cy r fill="blue">` en el **primer punto del primer trazo** (matching el cx/cy manual de los JSX). `r = Math.ceil(stroke / 1.4)` — misma formula que usan los componentes. `fill="blue"` inline reproduce el marcador visible del `base.svg` de referencia.
- Atributos estaticos, no JSX: `class` (no `className`), `stroke-width` (no `strokeWidth`).

---

## Inputs subidos por el usuario (Paso 1)

Estos no son parte del bundle de salida, pero definen el flujo de trazado:

### base.svg (subido por el usuario)

La ilustracion de fondo: letra coloreada, flechas direccionales, numero de orden del trazo, cualquier decoracion. Se muestra como capa base en el drawer (zIndex 1) y en el preview. **No** se inspecciona programaticamente — solo se renderiza como imagen. No se confunda con el `base.svg` que genera esta herramienta (plantilla de animación con `<path class="svgPath">` para el reader): son dos ficheros distintos que simplemente comparten nombre.

Ver `ejemplo/trazado-letra-a/base.svg` como forma canonica.

### guia.svg

El punteado guia que indica por donde pasa el trazo. Sirve dos proposito:

1. **Guia visual**: se renderiza encima de `base.svg` (zIndex 2) en el drawer y el preview para que el usuario sepa por donde trazar.
2. **Esqueleto de snap**: `guideExtractor.extractGuideFromSvg` lo rasteriza, binariza por pixel opaco (`alpha >= 64`), cierra los gaps entre dashes (`closePasses: 4`) y skeletoniza con Zhang-Suen para producir la polilinea contra la que se ajustan los trazos al soltar el mouse.

Ver `ejemplo/trazado-letra-a/guia.svg` como forma canonica.

---

## Estructura de Carpetas de Exportacion

### Individual (ZIP de una letra)

```
trazado-letra-a.zip
  trazado-letra-a/
    data.json
    base.svg
```

### Masiva (ZIP de todas las letras)

```
trazados-ligada.zip          (o trazados-mayusculas.zip)
  ligada/                    (o mayusculas/)
    trazado-letra-a/
      data.json
      base.svg
    trazado-letra-b/
      data.json
      base.svg
    ...
```

### Archivos que **ya no se exportan**

- `character.png`
- `fondo.png`
- `audio/es/title.mp3`, `audio/val/title.mp3`
- `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`
- `thum.png`

Si la app consumidora los necesita, los provee el pipeline de contenido aparte — esta herramienta unicamente emite lo que depende de los trazos dibujados (`data.json` + `base.svg`).
