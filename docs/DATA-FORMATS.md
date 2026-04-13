# Formatos de Datos - Schemas y Estructuras

## data.json

Archivo principal que describe el trazado de una letra. Estructura completa:

```json
{
  "activityId": "trazados",
  "sectionId": "trazados",
  "title": {
    "es": "Trazado de la letra <<a>>.",
    "val": "Trazado de la letra <<a>>.",
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
  "letterSize": [380, 340],       // Dinamico: varia por letra en modo font
  "animationPathStroke": 16,      // Dinamico: calculado segun tipo y ancho
  "letterAnimationPath": [
    { "selector": "#path1", "time": 10 },
    { "selector": "#path2", "time": 8 }
  ],
  "dotSize": 33,                  // Dinamico: calculado segun tipo y ancho
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

### Campos clave

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `letter` | string | Identificador de la letra. Ligada: `"a"`, `"b"`, etc. Mayusculas: `"UpperA"`, `"UpperB"`, etc. |
| `letterSize` | `[width, height]` | Dimensiones del canvas en px. **Dinamico en modo font**: varia por letra (ej: ligada "i" ~157×340, "m" ~600×340; mayusculas "I" ~95×315, "M" ~440×315). Default 380×340 si se fuerza manualmente. |
| `animationPathStroke` | number | Grosor del trazo de animacion. **Dinamico**: ligada 10-18, mayusculas 10-12. |
| `letterAnimationPath` | array | Selectores CSS para paths del SVG dotted y tiempo de animacion |
| `dotSize` | number | Tamano visual de cada punto en la UI. **Dinamico**: ligada 26-40, mayusculas 33-40. |
| `playButtonPosition` | `[x, y]` | Posicion relativa del boton play |
| `dotList` | array | Array de trazos. Cada trazo tiene `dragger` y `coordinates` |

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

- **`dragger`**: Coordenadas `[x, y]` del punto de inicio del trazo (donde aparece el "dragger" que el usuario arrastra)
- **`coordinates`**: Array de puntos que forman el recorrido del trazo
  - `coords`: Array `[x, y]` con las coordenadas en espacio de letra
  - `corner` (opcional): `true` si el punto es una esquina/cambio de direccion significativo (angulo > 45 grados)

### Campo `letter` - Valores especiales

- Ligada minusculas: `"a"`, `"b"`, `"c"`, ..., `"z"`, `"ny"` (ene), `"ch"`, `"ll"`
- Mayusculas: `"UpperA"`, `"UpperB"`, ..., `"UpperZ"`, `"UpperNy"`, `"UpperCh"`, `"UpperLl"`

### Multi-stroke (letras con varios trazos)

Letras como "A" mayuscula tienen multiples trazos. El array `dotList` tendra multiples elementos:

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

El indice de cada dotList entry corresponde al indice del letterAnimationPath.

---

## SVG Files

### letter-fill.svg

SVG con la letra completamente rellena. Se usa como feedback visual cuando el usuario completa el trazado.

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "...">
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><path id="fill" d="M..." style="fill-rule:nonzero;"/></g></g>
</svg>
```

**Importante**: El path debe tener `id="fill"`.

### letter-outline.svg

SVG con el contorno de la letra (sin relleno). Se muestra como guia visual de fondo mientras el usuario traza.

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><path id="contorno" d="M..."
    style="fill:none;stroke:#000;stroke-width:3px;stroke-linecap:round;stroke-linejoin:round;"/></g></g>
</svg>
```

**Importante**: El path debe tener `id="contorno"`.

### letter-dotted.svg

SVG con la linea central punteada que guia el recorrido del trazado. Puede contener multiples paths (uno por trazo).

```xml
<svg width="100%" height="100%" viewBox="0 0 380 340" ...>
  <g><g><g id="path">
    <path id="path1" d="M..."
      style="fill:none;stroke:#ccc;stroke-width:8px;stroke-linecap:round;stroke-dasharray:0.1,16;"/>
    <path id="path2" d="M..."
      style="fill:none;stroke:#ccc;stroke-width:8px;stroke-linecap:round;stroke-dasharray:0.1,16;"/>
  </g></g></g>
</svg>
```

**Importante**:
- El grupo contenedor debe tener `id="path"`
- Cada path individual: `id="path1"`, `id="path2"`, etc.
- El `stroke-dasharray: 0.1,16` crea el efecto punteado
- Los selectores en `letterAnimationPath` del data.json apuntan a estos IDs (`#path1`, `#path2`)

### Formato SVG comun

Todos los SVGs comparten:
- DOCTYPE SVG 1.1
- `width="100%" height="100%"`
- `viewBox="0 0 {width} {height}"` donde width/height coinciden con letterSize
- Namespace SVG y xlink

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
    character.png
    thum.png
    fondo.png
    audio/
      es/title.mp3
      val/title.mp3
```

### Masiva (ZIP de todas las letras)

```
trazados-ligada.zip          (o trazados-mayusculas.zip)
  ligada/                    (o mayusculas/)
    trazado-letra-a/
      data.json
      letter-fill.svg
      ...
    trazado-letra-b/
      ...
```

### Placeholders

Si no se suben assets:
- **Audio**: MP3 silencioso minimo (32 bytes, MPEG1 Layer 3)
- **Imagenes**: PNG transparente 1x1 pixel
