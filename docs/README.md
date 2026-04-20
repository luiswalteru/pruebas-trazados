# Trazados Generator - Documentacion del Proyecto

## Descripcion General

Aplicacion standalone Vite + React para generar ejercicios interactivos de trazado de letras ("trazados") para una app educativa infantil. Por cada letra se generan `data.json`, los tres SVGs (`letter-fill`, `letter-outline`, `letter-dotted`) y un `thum.png` auto-generado, en dos variantes: **ligada** (cursiva minusculas) y **mayusculas**.

> **Estado actual (abril 2026)**: dibujo manual sobre una imagen/SVG de referencia. El usuario sube un SVG ilustrado (letra + linea punteada guia + personaje) y dibuja el recorrido con el cursor. Al soltar, el trazo se proyecta automaticamente sobre la polilinea de puntos guia extraida del SVG. PNG/JPG tambien se aceptan como fallback (usan el centrado clasico por distance transform).
>
> Los archivos `src/utils/pathSampler.js` y `src/utils/fontParser.js` no se importan en ningun lado — son legacy. El export nunca incluye `character.png`, `fondo.png` ni audios; `thum.png` se genera automaticamente al rasterizar fill + dotted.

## Instalacion y Ejecucion

```bash
npm install
npm run dev      # Servidor de desarrollo en http://localhost:5173 (auto-abre)
npm run build    # Build de produccion
npm run preview  # Preview del build de produccion
```

**Nota sobre build**: Si hay errores de permisos al escribir en `dist/`, usar:
```bash
npx vite build --outDir /tmp/trazados-dist
```

No hay tests, linter ni typecheck configurados. La "correctitud" se valida compilando, corriendo el dev server y probando el wizard + PreviewPage manualmente.

## Stack Tecnologico

- **Vite 6** + **@vitejs/plugin-react** - Bundler y HMR
- **React 18** + **React Router DOM 6** - UI y navegacion SPA
- **JSZip 3.10.1** - Generacion de archivos ZIP
- **file-saver 2.0.5** - Descarga de archivos desde el navegador

`opentype.js` sigue como dependencia de `package.json` pero ya no se importa — el flujo actual no usa fuentes tipograficas.

## Estructura del Proyecto

```
trazados-generator/
  index.html
  package.json
  vite.config.js
  docs/                             # Documentacion del proyecto
    README.md                       # Este archivo
    DATA-FORMATS.md                 # Schemas de data.json y SVGs
    UTILITIES.md                    # Documentacion de utilidades
    COMPONENTS.md                   # Documentacion de componentes
    PENDING-TASKS.md                # Tareas pendientes y problemas
  ejemplo/
    trazado-letra-a/                # Bundle de referencia (formato antiguo con audio/imagenes)
  src/
    main.jsx                        # Entry point con BrowserRouter
    App.jsx                         # Layout principal con navegacion
    App.css                         # Estilos globales de toda la app
    pages/
      HomePage.jsx                  # Landing minimalista con un solo CTA
      GeneratorPage.jsx             # Wizard principal de 4 pasos
      PreviewPage.jsx               # Preview interactivo del trazado
    components/
      ManualPathDrawer.jsx          # Canvas de dibujo manual + proyeccion del trazo al soltar
    utils/
      guideExtractor.js             # Rasterizado del SVG -> segmentacion -> polilinea + proyeccion
      letterMask.js                 # Distance transform + centerStrokePoints (fallback PNG/JPG)
      svgGenerator.js               # Generacion de SVGs (fill, outline, dotted + fallbacks de strokes)
      thumGenerator.js              # Rasteriza fill + dotted a thum.png
      dataGenerator.js              # Generacion de data.json + nombres de carpeta + computeLetterParams
      exportUtils.js                # Exportacion ZIP con JSZip
      fontParser.js                 # LEGACY — no se importa
      pathSampler.js                # LEGACY — no se importa
```

## Flujo de la Aplicacion

### GeneratorPage - Wizard de 3 Pasos

**Paso 1: Tipo, letra e imagen** - Elegir entre "ligada" o "mayusculas", seleccionar **una sola letra** del grid (seleccion exclusiva — click en otra la reemplaza), y subir la imagen de referencia para esa letra. Se aceptan `.svg`, `.png`, `.jpg`. El uso recomendado es un SVG ilustrado con la letra + la linea punteada guia + el personaje; el extractor identifica automaticamente los puntos guia. El abecedario tiene 27 letras (a-z + ñ) + ch + ll.

**Paso 2: Dibujar trazado** - Config (canvas w/h, dotCount, dotSize, strokeWidth, parametros del dotted-svg) + `ManualPathDrawer` con la imagen de referencia de fondo. El usuario dibuja libre; al soltar el boton del mouse el trazo se proyecta sobre la polilinea extraida del SVG (o sobre el eje medial si el input era raster). Tick ✓ junto al titulo cuando hay trazado guardado. Boton "Generar y continuar" -> paso 3.

**Paso 3: Exportar** - Lista de trazados generados con valores computados (canvas, dotSize, stroke, cantidad de trazos, puntos por trazo). Botones: `Preview` (navega a `/preview`), `Exportar` (ZIP individual), `Exportar todos como ZIP` (ZIP masivo). `thum.png` se genera al exportar; no hay uploads de assets ni `character.png`/`fondo.png`/audios.

### Valores Dinamicos

Solo `dotSize` y `animationPathStroke` se calculan dinamicamente (via `computeLetterParams(letter, type, canvasW)`). Canvas size ya no se auto-computa — es siempre lo que el usuario configura en el paso 3.

| Parametro | Ligada | Mayusculas | Como se calcula |
|-----------|--------|------------|-----------------|
| dotSize | 26–40 | 34 (40 si canvasW > 240) | Basado en canvasW + overrides para e, i, k, m, n, u, p |
| animationPathStroke | 10–18 | 10 (12 si canvasW > 350) | Basado en canvasW |

**Patron de override**: `0 = auto-compute` en los inputs, `>0 = forzar el valor`.

### Persistencia de Estado

El estado del generador (incluyendo la imagen cargada por letra en `images`) se persiste en `window.__generatorState` en un `useEffect` sin dependencias (se ejecuta cada render) para sobrevivir a la navegacion a Preview y de vuelta. El paso actual se lee/escribe en el URL param `?step=N`. El preview recibe datos via `window.__trazadoPreview`.

### PreviewPage - Preview Interactivo

Simula el trazado real como lo haria el componente React de la app educativa:
- Muestra el outline SVG como guia tenue de fondo, el dotted como puntos
- El usuario hace click para iniciar, luego mueve el cursor por los puntos
- Hit radius generoso: `max(dotSize, 28)` px
- Multi-stroke: al completar un trazo avanza al siguiente
- Al completar todo: muestra el fill SVG con animacion fade-in
- Modo debug (activo por defecto): visualiza todos los dots con indices, el hit radius, distancia al target, y el JSON del dotList

## Estructura de Salida por Letra

Cada letra genera una carpeta con esta estructura (lo que empaqueta el ZIP):

```
trazado-letra-{nombre}/
  data.json               # Datos del trazado (dotList, metadata)
  letter-fill.svg         # SVG con la letra rellena (path id="fill")
  letter-outline.svg      # SVG con el contorno (path id="contorno")
  letter-dotted.svg       # SVG con un <path id="pathN"> dasheado por trazo, dentro de <g id="path">
                          # (stroke-dasharray:0.1,16 + stroke-linecap:round genera el efecto punteado)
  thum.png                # Rasterizacion auto-generada de fill + dots
```

> **Nota**: El `data.json` aun declara campos `character: "character.png"` y `title.audio.{es,val}: "audio/{es,val}/title"`, pero esos archivos **ya no se incluyen en el ZIP**. Si el componente consumidor los requiere, habra que proveerlos aparte o dejar de emitir esos campos.

### Nombrado de Carpetas

- Ligada: `trazado-letra-a`, `trazado-letra-b`, ..., `trazado-letra-ny` (para ñ), `trazado-letra-ch`, `trazado-letra-ll`
- Mayusculas: `trazado-letra-a-mayus`, `trazado-letra-b-mayus`, ...

### Exportacion Masiva

Al exportar todos, se agrupan bajo una carpeta con el tipo:
```
trazados-ligada.zip
  ligada/
    trazado-letra-a/
    trazado-letra-b/
    ...
```
o
```
trazados-mayusculas.zip
  mayusculas/
    trazado-letra-a-mayus/
    ...
```

### Bundle de referencia

`ejemplo/trazado-letra-a/` conserva el formato **antiguo** (con `character.png`, `fondo.png`, `audio/es/title.mp3`, `audio/val/title.mp3` y un `letter-dotted.svg` con `stroke-dasharray`). Es util como referencia del shape que el componente consumidor soportaba historicamente, pero **no** refleja lo que el generador produce hoy.
