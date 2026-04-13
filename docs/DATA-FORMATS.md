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

SVG con el contorno de la letra. Se muestra como guia visual de fondo mientras el usuario traza.

- Con fuente: `generateOutlineSvg` — un unico `<path id="contorno">`.
- Sin fuente: `generateOutlineSvgFromStrokes` — un `<path id="contornoN">` por trazo.

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><path id="contorno" d="M..."
    style="fill:none;stroke:#000;stroke-width:3px;stroke-linecap:round;stroke-linejoin:round;"/></g></g>
</svg>
```

### letter-dotted.svg

**Formato actual (abril 2026)**: Un `<circle>` por coordenada muestreada, agrupados por trazo. **Ya no son `<path>` con `stroke-dasharray`**.

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g>
    <g id="path1">
      <circle cx="190" cy="85" r="8" fill="#888"/>
      <circle cx="185.12" cy="90.45" r="8" fill="#888"/>
      ...
    </g>
    <g id="path2">
      <circle cx="100" cy="270" r="8" fill="#888"/>
      ...
    </g>
  </g></g>
</svg>
```

**Contrato con el componente consumidor**:
- Cada trazo es un `<g id="path{i+1}">` cuyas coordenadas coinciden 1:1 con `data.json.dotList[i].coordinates`.
- Los selectores en `letterAnimationPath` (`#path1`, `#path2`, ...) apuntan a esos `<g>`.
- El radio de los circulos se calcula como `max(4, round(dotSize / 4))`.

El bundle de referencia `ejemplo/trazado-letra-a/letter-dotted.svg` usa el formato **antiguo** (path dasheado). Si el componente consumidor dependia de ese formato, hay que actualizarlo o cambiar `generateDottedSvg` para emitirlo de vuelta.

### Formato SVG comun

Todos los SVGs comparten:
- DOCTYPE SVG 1.1
- `width="100%" height="100%"`
- `viewBox="0 0 {width} {height}"` donde width/height coinciden con `letterSize`
- Namespace SVG y xlink

---

## thum.png (nuevo)

Generado automaticamente por `generateThumPngBlob` en `src/utils/thumGenerator.js` al exportar. Es una rasterizacion PNG de:

1. **Capa fill**: el glifo de referencia (si hay fuente) o los trazos del usuario engrosados.
2. **Capa de dots**: un circulo magenta (`#e91e63`) por cada `coordinates[i].coords` de cada trazo, radio = `max(4, round(dotSize / 4))`.

Tamaño en pixeles = `letterSize` del `data.json`. No configurable desde la UI.

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
