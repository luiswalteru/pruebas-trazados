# Trazados Generator - Documentacion del Proyecto

## Descripcion General

Aplicacion standalone Vite + React para generar ejercicios interactivos de trazado de letras ("trazados") para una app educativa infantil. Por cada letra se genera un bundle minimo con **`data.json` + `base.svg`**, en dos variantes: **ligada** (cursiva minusculas) y **mayusculas**.

> **Estado actual (abril 2026)**: flujo de dos-SVG-subidos. En el Paso 1 el usuario sube dos SVG por letra:
>
> - **`bg.svg`** — la ilustracion de fondo (letra coloreada + flechas + numero de orden + personajes decorativos).
> - **`dotted.svg`** — el punteado que indica por donde debe pasar el trazo.
>
> En el Paso 2 ambos se apilan (bg debajo, dotted encima) como guia visual y el usuario dibuja encima con el cursor. El ajuste al soltar el trazo se hace contra el **esqueleto extraido automaticamente de `dotted.svg`**: el extractor rasteriza el SVG, detecta los pixeles opacos, cierra los gaps entre dashes y skeletoniza.
>
> El bundle exportado **solo contiene `data.json` + `base.svg`**. `bg.svg` y `dotted.svg` se autoran aparte y los despliega el pipeline de contenido — no se re-emiten desde este generador. `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `thum.png`, `character.png` y los audios **ya no se producen**.
>
> Los archivos `src/utils/pathSampler.js`, `src/utils/fontParser.js`, `src/utils/thumGenerator.js` y gran parte de `src/utils/svgGenerator.js` (todo menos `generateBaseSvg`) son **codigo muerto**: no se importan en ningun lado y se mantienen solo por referencia historica.

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

`opentype.js` sigue como dependencia de `package.json` pero ya no se importa.

## Estructura del Proyecto

```
trazados-generator/
  index.html
  package.json
  vite.config.js
  docs/                             # Documentacion del proyecto
    README.md                       # Este archivo
    DATA-FORMATS.md                 # Schema de data.json y base.svg
    UTILITIES.md                    # Documentacion de utilidades
    COMPONENTS.md                   # Documentacion de componentes
    PENDING-TASKS.md                # Tareas pendientes y problemas
  ejemplo/
    trazado-letra-a/                # Carpeta de referencia. Contiene los
                                    # inputs canonicos (bg.svg + dotted.svg)
                                    # y tambien el bundle historico antiguo
                                    # con assets (audio/, character.png, ...)
                                    # que **ya no** refleja lo que exporta
                                    # esta herramienta.
  src/
    main.jsx                        # Entry point con BrowserRouter
    App.jsx                         # Layout principal con navegacion
    App.css                         # Estilos globales de toda la app
    pages/
      HomePage.jsx                  # Landing minimalista con un solo CTA
      GeneratorPage.jsx             # Wizard principal de 3 pasos
      PreviewPage.jsx               # Preview interactivo del trazado
    components/
      ManualPathDrawer.jsx          # Canvas de dibujo manual + proyeccion
                                    # del trazo al soltar sobre el esqueleto
                                    # de dotted.svg
    utils/
      guideExtractor.js             # Rasterizado -> segmentacion -> polilinea
                                    # + proyeccion. Soporta dos modos:
                                    # 'white-body' (legado PNG) y 'any-opaque'
                                    # (SVG uploads, el unico activo hoy).
      letterMask.js                 # Distance transform + fallback raster
      svgGenerator.js               # generateBaseSvg (unico en uso). El resto
                                    # del archivo es codigo muerto.
      dataGenerator.js              # Generacion de data.json + nombres de
                                    # carpeta + computeLetterParams
      exportUtils.js                # ZIP con JSZip (solo data.json + base.svg)
      thumGenerator.js              # LEGACY — no se importa
      fontParser.js                 # LEGACY — no se importa
      pathSampler.js                # LEGACY — no se importa
```

## Flujo de la Aplicacion

### GeneratorPage - Wizard de 3 Pasos

**Paso 1: Tipo, letra e imagenes** - Elegir entre "ligada" o "mayusculas", seleccionar **una sola letra** del grid (seleccion exclusiva — click en otra la reemplaza), y subir los dos SVG de referencia para esa letra: `bg.svg` (base) y `dotted.svg` (guia). Ambos son obligatorios para avanzar. El panel muestra una vista previa apilada de los dos archivos para confirmar que se alinean correctamente. El abecedario tiene 27 letras (a-z + ñ) + ch + ll.

**Paso 2: Dibujar trazado** - Config (canvas w/h, dotCount, dotSize, strokeWidth) + `ManualPathDrawer` con `bg.svg` + `dotted.svg` apilados como guia visible. El usuario dibuja libre con el cursor; al soltar el mouse, el trazo se proyecta sobre la polilinea extraida del esqueleto de `dotted.svg`. Tick ✓ junto al titulo cuando hay trazado guardado. Boton "Generar y continuar" → paso 3.

**Paso 3: Exportar** - Lista de trazados generados con valores computados (canvas, dotSize, stroke, cantidad de trazos, puntos por trazo). Botones: `Preview` (navega a `/preview`), `Preview en reader` (escribe al reader local via dev-server middleware), `Exportar` (ZIP individual), `Exportar todos como ZIP` (ZIP masivo). El ZIP solo contiene `data.json` + `base.svg` por letra.

### Valores Dinamicos

Solo `dotSize` y `animationPathStroke` se calculan dinamicamente (via `computeLetterParams(letter, type, canvasW)`). Canvas size siempre es lo que el usuario configura en el Paso 2.

| Parametro | Ligada | Mayusculas | Como se calcula |
|-----------|--------|------------|-----------------|
| dotSize | 26–40 | 34 (40 si canvasW > 240) | Basado en canvasW + overrides para e, i, k, m, n, u, p |
| animationPathStroke | 10–18 | 10 (12 si canvasW > 350) | Basado en canvasW |

**Patron de override**: `0 = auto-compute` en los inputs, `>0 = forzar el valor`.

### Persistencia de Estado

El estado del generador (incluyendo los dos SVG cargados por letra en `images: { [letter]: { bg, dotted } }`) se persiste en `window.__generatorState` en un `useEffect` sin array de dependencias (se ejecuta cada render) para sobrevivir a la navegacion a Preview y de vuelta. El paso actual se lee/escribe en el URL param `?step=N`. El preview recibe datos via `window.__trazadoPreview`, incluyendo los SVG subidos (`bgSvg`, `dottedSvg`) para reproducir fielmente el fondo visible.

### PreviewPage - Preview Interactivo

Simula el trazado real como lo haria el componente React de la app educativa:
- Apila `bg.svg` + `dotted.svg` de fondo (igual que en el drawer)
- El usuario hace click para iniciar, luego mueve el cursor por los puntos
- Hit radius generoso: `max(dotSize, 28)` px
- Multi-stroke: al completar un trazo avanza al siguiente
- Al completar todo: oculta el overlay de dots/strokes (ya no hay fill SVG generado que mostrar)
- Modo debug (activo por defecto): visualiza todos los dots con indices, el hit radius, distancia al target, y el JSON del dotList

## Estructura de Salida por Letra

Cada letra genera una carpeta con esta estructura (lo que empaqueta el ZIP):

```
trazado-letra-{nombre}/
  data.json               # Datos del trazado (dotList, metadata, letterSize)
  base.svg                # Template animable del reader (paths + circle)
```

Nada mas. `bg.svg` y `dotted.svg` los autora el pipeline de contenido y llegan al reader por otra via — esta herramienta solo genera lo que depende de los trazos dibujados.

### Nombrado de Carpetas

- Ligada: `trazado-letra-a`, `trazado-letra-b`, ..., `trazado-letra-ny` (para ñ), `trazado-letra-ch`, `trazado-letra-ll`
- Mayusculas: `trazado-letra-a-mayus`, `trazado-letra-b-mayus`, ...

### Exportacion Masiva

Al exportar todos, se agrupan bajo una carpeta con el tipo:

```
trazados-ligada.zip
  ligada/
    trazado-letra-a/
      data.json
      base.svg
    trazado-letra-b/
      data.json
      base.svg
    ...
```

### Bundle de referencia

`ejemplo/trazado-letra-a/` contiene los inputs canonicos del nuevo flujo:

- **`bg.svg`** — shape de la ilustracion de fondo que se espera subir en el Paso 1 (slot "bg").
- **`dotted.svg`** — shape del punteado guia que se espera subir en el Paso 1 (slot "dotted").

Tambien contiene el bundle historico antiguo (`letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `character.png`, `fondo.png`, audios, `thum.png`) de cuando la herramienta producia todos esos archivos. **Ese bundle ya no se genera** — utilizarlo solo como referencia de que esperaba el reader en iteraciones anteriores.
