# Tareas Pendientes y Problemas Conocidos

## Estado actual del proyecto

Abril 2026. Flujo de **dos-SVG-subidos + dibujo manual + proyeccion al soltar**:

1. El usuario sube dos SVG por letra en el Paso 1: **`base.svg`** (ilustracion de fondo) y **`guia.svg`** (punteado guia).
2. `guideExtractor.extractGuideFromSvg` rasteriza `guia.svg` con fondo transparente, binariza por pixel opaco (`alpha >= 64`), cierra los gaps entre dashes con 4 pasadas de dilate+erode, y skeletoniza con Zhang-Suen. Las polilineas resultantes se usan como guia de snap.
3. El usuario dibuja libre con el cursor (EMA ligero, sin snap en tiempo real). Al soltar, `projectStrokeOnGuide` proyecta cada punto sobre la polilinea con sesgo direccional lateral (estimado desde la trayectoria cruda del cursor).
4. Si la extraccion de la polilinea falla, se usa el fallback raster `centerStrokePoints` (distance transform sobre los pixeles opacos del mismo `guia.svg`).
5. El bundle exportado por letra es **solo `data.json` + `base.svg`** (plantilla animable — distinta del `base.svg` que el usuario sube, que es la ilustración y no se re-emite).

---

## Tareas pendientes

### 1. Desajuste en el campo `letter` para ñ
**Prioridad: Media**

- `getFolderName` mapea `ñ` → `ny` (carpeta `trazado-letra-ny` / `trazado-letra-ny-mayus`).
- `generateDataJson` escribe `letter` como `"ñ"` / `"UpperÑ"` (sin mapeo).

Si el consumidor espera `"ny"` / `"UpperNy"` en el campo `letter` (como implica el formato de carpeta), hay que ajustar uno de los dos lados.

### 2. Testing manual en navegador
**Prioridad: Alta**

- [ ] Subir un par `base.svg` + `guia.svg` estilo `ejemplo/trazado-letra-a/` — verificar que el badge "Ajuste al soltar: esqueleto de guia.svg (N puntos)" aparece y que "Ver guia" muestra una polilinea coherente.
- [ ] Dibujar una letra con loop (cursiva a/e/o) y comprobar que al soltar el trazo no salta al otro lado del ovalo.
- [ ] Subir un `guia.svg` con dashes muy separados (gap > dash) — verificar si `closePasses: 4` es suficiente o si hace falta subirlo.
- [ ] Probar un `guia.svg` degenerado (pocos pixeles) — debe caer a fallback raster o a modo `'none'` sin crash.
- [ ] Preview reproduce bien los trazados generados con ilustración (`base.svg`) + punteado (`guia.svg`) apilados.
- [ ] Atajos de teclado (N, Ctrl+Z, Enter, Esc).
- [ ] Export individual + masivo (ZIP debe contener solo `data.json` + `base.svg` por letra).
- [ ] Preview en reader (middleware del dev server).
- [ ] Override de `dotSize` / `animationPathStroke` (0 vs >0).
- [ ] Combos (`ch`, `ll`) end-to-end.

### 3. Calibracion del extractor SVG
**Prioridad: Media**

Los parametros del modo `'any-opaque'` (`minAlpha=64`, `minArea=20`, `minComponentRatio=0.05`, `closePasses=4`, `renderScale=2`) estan tuneados contra `ejemplo/trazado-letra-a/guia.svg`. Con SVGs muy distintos en densidad de dashes pueden fallar.

- [ ] Probar mas `guia.svg` reales y, si hay patrones claros de fallo, exponer los parametros como sliders de debug en la UI.
- [ ] Evaluar si `closePasses` deberia ser adaptativo (basado en la mediana de la separacion entre blobs detectados) en lugar de un numero fijo.

### 4. Calibracion del sesgo direccional
**Prioridad: Baja**

`snapToPolyline` usa `lateralBias = 2.5`, `backwardPenalty = 0.4`, `dirLookback = 15px`. Si aparecen casos donde:

- El trazo lucha contra el usuario en curvas muy cerradas → bajar `lateralBias` a ~1.5
- Salta entre tramos paralelos muy cercanos → subir `lateralBias` a 3.5–4 o reducir `maxDist` a 60–70

Ajuste directo en `guideExtractor.js`. Considerar slider de debug si se repite.

### 5. Codigo muerto eliminable
**Prioridad: Baja**

Tras el refactor de dos-SVG-subidos, lo siguiente es dead code sin callers:

- [ ] Eliminar `src/utils/thumGenerator.js` (ya no se genera `thum.png`).
- [ ] Adelgazar `src/utils/svgGenerator.js` dejando solo `generateBaseSvg`. Quitar `generateFillSvg`, `generateFillSvgFromStrokes`, `generateOutlineSvg`, `generateOutlineSvgFromStrokes`, `generateDottedSvg`.
- [ ] Eliminar `src/utils/fontParser.js` y `src/utils/pathSampler.js` (legacy).
- [ ] Quitar `opentype.js` de `package.json` (dependencia de `fontParser.js`).
- [ ] Eliminar `letterMask.buildLetterMask` (sin callers).
- [ ] Eliminar `dataGenerator.computeDotCount` (sin callers).
- [ ] Considerar si el modo `'white-body'` de `extractGuideMaskFromImage` todavia tiene razon de existir, o si se puede colapsar a solo `'any-opaque'` (el unico que se llama en produccion).

### 6. Mejoras UX (baja)

- [ ] Progreso durante generacion/export masivo.
- [ ] Thumbnail miniatura de cada trazado en el Paso 3 (ahora que no hay `thum.png`, podria generarse client-side on-the-fly rasterizando la plantilla animable generada sobre el `base.svg` de ilustración).
- [ ] Reordenar trazos manualmente (hoy el orden es el de dibujo).
- [ ] Batch-upload de `base.svg` + `guia.svg` para varias letras a la vez (hoy es letra-a-letra).

---

## Problemas resueltos

- **Snap en tiempo real se sentia pegajoso / saltaba de lado en loops**: se movio el ajuste a `endStroke`. Durante el dibujo el cursor va libre; al soltar se proyecta con sesgo direccional basado en la trayectoria cruda.
- **Shortcut edges al cerrar el loop de la "a"**: bias lateral a 2.5 + `rawHistory` para evitar feedback desde proyecciones previas mal caidas.
- **Flecha/numero de orden del PNG contaminaba el esqueleto**: en el modo `'white-body'` se filtraba por RGB cercano a blanco + relleno de agujeros pequeños. En el modo actual `'any-opaque'` el problema desaparece porque `guia.svg` no incluye esos adornos — la ilustracion queda en el `base.svg` subido, que nunca se analiza.
- **Trazados temblorosos / descentrados**: EMA sobre el cursor + proyeccion al soltar.
- **Placeholders MP3/PNG no significativos**: se dejo de empaquetar assets que el generador no puede producir. `thum.png` tambien se elimino en el refactor de dos-SVG — ahora la ilustración (`base.svg` subido) y el punteado (`guia.svg` subido) vienen autorados aparte.
- **Navegacion Preview → Generador reiniciaba estado**: persistencia en `window.__generatorState` + `?step=N`. Incluye `images: { [letter]: { base, guia } }`.
- **Preview no podia terminar el trazado**: `box-sizing: content-box`, sin reset en mouseUp, hit radius `max(dotSize, 28)`.
- **Offset de ≈ 1.43 u en cada click**: el contenedor del drawer (y del preview) es `content-box` con borde de 2 px; `getBoundingClientRect` devuelve el border-box, asi que cada click quedaba desplazado `borderWidth / SCALE`. Se resta `clientLeft` / `clientTop` al offset en `toLetterCoords` (`ManualPathDrawer`) y `screenToLetter` (`PreviewPage`). Ahora el pixel superior-izquierdo del area dibujable mapea a letter-space `(0, 0)`.
- **Trazo en curso quedaba sin proyectar al pulsar `Enter`**: `handleFinalize` combinaba `strokes` (ya ajustados en `endStroke`) con `currentStroke` crudo, dejando el ultimo trazo en otro espacio que el resto. Ahora el trazo en curso pasa por `adjustStrokeToGuide` antes de agregarse.
- **Mismatch silencioso entre viewBox del `base.svg`/`guia.svg` subido y canvas del Paso 2**: `GeneratorPage.handleSvgUpload` parsea las dimensiones intrinsecas del SVG (via `parseSvgDims`) y emite `console.warn` si no coinciden con `canvasWidth`×`canvasHeight`. No se auto-sobreescribe el canvas porque eso cambiaria `computeLetterParams` (dotSize / stroke) y el escalado del drawer.
- **Campos `character`/`letterFill`/`letterOutline`/`letterDotted` en `data.json`**: se mantienen con los valores de referencia (`"character.png"`, `"letter-fill.svg"`, etc.) porque el reader los lee. Los archivos apuntados los aporta el pipeline de contenido, no esta herramienta. El shape matches `ejemplo/trazado-letra-a/data.json`.
- **`stroke-width` variaba por letra en `base.svg`**: `computeLetterParams` devolvia entre 10 y 18 según la letra/canvas. Ahora retorna `animationPathStroke: 16` constante (matching `ejemplo/trazado-letra-a/base.svg`). El usuario puede forzar otro valor desde el input `strokeWidth > 0`.
- **`base.svg` sin `stroke`/`fill` inline**: el SVG emitido solo tenía `stroke-width` + `fill="none"` en cada path, y el `<circle>` sin `fill`. Si la CSS del reader no cargaba o tardaba, el path salía negro y el marcador invisible. Ahora `<path stroke="#f04e23" fill="none" stroke-width="S">` y `<circle fill="blue">` — fallbacks de presentación inline que replican la referencia canónica.
- **`fixedDot` del reader desalineado con el inicio del trazo**: el `#fixedDot` es un `div` 20×20 posicionado por su esquina superior-izquierda via `transform: translate`. Se corrigió `dragger` en `handleFinalize` para restar `(10, 10)` del primer punto, centrando visualmente el div sobre el inicio del trazo. Coincide con el patrón de la referencia (`dragger ≈ firstCoord − (10, 10)`).
- **Archivos de input renombrados**: `bg.svg` → `base.svg` (ilustración) y `dotted.svg` → `guia.svg` (punteado). Estado interno (`images[letter]`), refs, props, labels UI, ejemplo y docs actualizados. El `base.svg` subido comparte nombre con el `base.svg` emitido (plantilla animable) pero son ficheros distintos que nunca conviven en el mismo scope del código.
- **Default de `dotCount`**: era `0` (se colaba al drawer como 0 y producía `dotList` vacíos). Ahora `25` tanto en `GeneratorPage` como en el default prop de `ManualPathDrawer`.
- **Puerto del dev server**: 5173 → 5177 (`vite.config.js`).

### Conocidos sin fix

- `dist/` con permisos restrictivos en esta workstation: `npx vite build --outDir /tmp/trazados-dist`.
- Warnings de rollup platform-specific al instalar: inofensivos.

---

## Contexto del proyecto destino

Los trazados se integran en:

```
public/lecto_pruebas_2026/assets/trazados/
  ligada/
    trazado-letra-a/
      data.json        (emitido por este generador)
      base.svg         (plantilla animable — emitida por este generador)
      guia.svg         (punteado — provisto por el pipeline de contenido)
      <ilustración>    (provista por el pipeline de contenido; el reader decide
                        su nombre/ruta final — puede que coexista con el
                        `base.svg` emitido bajo otra ruta o con otro nombre)
    ...
  mayusculas/
    trazado-letra-a-mayus/
      ...
```

El `base.svg` que el usuario sube al generador (ilustración de fondo) comparte nombre con el `base.svg` que el generador emite (plantilla animable). Dentro del código nunca conviven en el mismo scope; en la carpeta de despliegue del reader depende del pipeline de contenido cómo resuelve la colisión (p.ej. desplegando la ilustración bajo otra ruta o renombrándola al empaquetar).

Componente consumidor: carga `data.json`, renderiza la plantilla animable como SVG (paths con `stroke-dashoffset`), y apila la ilustración + `guia.svg` por detras como guia visual. Soporta multi-stroke via los selectores `#path1`, `#path2`, ...

---

## Archivos clave del flujo actual

- `src/pages/GeneratorPage.jsx` — wizard (3 pasos).
- `src/components/ManualPathDrawer.jsx` — canvas + proyeccion al soltar contra el esqueleto de `guia.svg`.
- `src/utils/guideExtractor.js` — `extractGuideFromSvg` + `snapToPolyline` / `projectStrokeOnGuide`.
- `src/utils/letterMask.js` — fallback raster (distance transform).
- `src/utils/svgGenerator.generateBaseSvg` — unico SVG que se emite.
- `src/utils/dataGenerator.js`, `exportUtils.js` — output.
