# Tareas Pendientes y Problemas Conocidos

## Estado actual del proyecto

Abril 2026. El flujo activo es:

1. El usuario sube una imagen de referencia por letra — preferentemente un SVG con escena completa (letra + linea punteada guia + personaje decorativo). PNG/JPG se aceptan como fallback.
2. `guideExtractor.extractGuideMaskFromImage` rasteriza el SVG, segmenta los blobs oscuros, descarta la letra y el personaje por tamaño, y arma una polilinea con los puntos guia restantes (edges K=2 + endpoints con grado 1).
3. El usuario dibuja libre con el cursor (EMA ligero contra jitter, sin snap en tiempo real). Al soltar, `projectStrokeOnGuide` proyecta cada punto sobre la polilinea con sesgo direccional lateral (estimado desde la trayectoria cruda del cursor, no la proyectada).
4. Si el input es PNG/JPG o la extraccion del SVG no encontro ≥3 puntos, se usa el fallback `centerStrokePoints` (distance transform chamfer 3-4).

---

## Tareas pendientes

### 1. Campos huerfanos en `data.json`
**Prioridad: Alta**

`generateDataJson` sigue emitiendo:
- `character: "character.png"`
- `title.audio.es: "audio/es/title"`, `title.audio.val: "audio/val/title"`

Pero esos archivos **no se incluyen en el ZIP**. Opciones:
- [ ] Dejar de emitir esos campos si no hay assets (romperia consumidores que los esperen no-null)
- [ ] Reintroducir uploads opcionales en el paso 3
- [ ] Confirmar que el consumidor tolera refs a archivos inexistentes

### 2. Desajuste en el campo `letter` para ñ
**Prioridad: Media**

- `getFolderName` mapea `ñ` → `ny` (carpeta `trazado-letra-ny` / `trazado-letra-ny-mayus`)
- `generateDataJson` escribe `letter` como `"ñ"` / `"UpperÑ"` (sin mapeo)

Si el consumidor espera `"ny"` / `"UpperNy"` hay que ajustar uno de los dos lados.

### 3. Testing manual en navegador
**Prioridad: Alta**

- [ ] Subir SVG estilo `ejemplo/trazado-letra-a/a_correct.svg` (escena completa) — verificar que el badge "Ajuste al soltar: guia SVG (N puntos)" aparece y que "Ver guia" muestra una polilinea coherente
- [ ] Dibujar una letra con loop (cursiva a/e/o) y comprobar que al soltar el trazo no salta al otro lado del ovalo
- [ ] Subir PNG/JPG — verificar que cae al fallback ("Ajuste al soltar: centrado por imagen") y que el centrado sigue funcionando
- [ ] Preview reproduce bien los trazados generados
- [ ] Atajos de teclado (N, Ctrl+Z, Enter, Esc)
- [ ] Export individual + masivo (ZIP debe contener solo `data.json` + 3 SVG + `thum.png`)
- [ ] Override de `dotSize` / `animationPathStroke` (0 vs >0)
- [ ] Combos (`ch`, `ll`) end-to-end

### 4. Calibracion del extractor
**Prioridad: Media**

Los parametros actuales (`darkLum=90`, `maxSat=0.28`, `discardLargest=3`, `minDotArea=3`, `maxDotFraction=0.15`, `renderScale=2`) estan tuneados contra `ejemplo/trazado-letra-a/a_correct.svg`. Con letras distintas o estilos de ilustracion distintos pueden fallar.

- [ ] Probar mas SVGs reales y, si hay patrones claros de fallo, exponer los parametros como sliders de debug en la UI.
- [ ] Evaluar si `discardLargest` deberia ser adaptativo (basado en histograma de areas) en lugar de un N fijo.

### 5. Calibracion del sesgo direccional
**Prioridad: Baja**

`snapToPolyline` usa `lateralBias = 2.5`, `backwardPenalty = 0.4`, `dirLookback = 15px`. Si aparecen casos donde:
- El trazo lucha contra el usuario en curvas muy cerradas → bajar `lateralBias` a ~1.5
- Salta entre tramos paralelos muy cercanos → subir `lateralBias` a 3.5-4 o reducir `maxDist` a 60-70

Ajuste directo en `guideExtractor.js`. Considerar slider de debug si se repite.

### 6. Codigo muerto definitivamente eliminable
**Prioridad: Baja**

- [ ] Eliminar `src/utils/pathSampler.js` y `src/utils/fontParser.js` si se confirma que no se reintroduce el flujo tipografico.
- [ ] Quitar `opentype.js` de `package.json` en ese caso.
- [ ] Eliminar `computeDotCount` de `dataGenerator.js` (exportado pero no se llama).

### 7. Mejoras UX (baja)
- [ ] Progreso durante generacion/export masivo
- [ ] Thumbnail miniatura de cada trazado en el paso 3
- [ ] Reordenar trazos manualmente (hoy el orden es el de dibujo)

---

## Problemas resueltos

- **Snap en tiempo real se sentia pegajoso / saltaba de lado en loops**: se movio el ajuste a `endStroke`. Durante el dibujo el cursor va libre; al soltar se proyecta con sesgo direccional basado en la trayectoria cruda.
- **Shortcut edges al cerrar el loop de la "a"**: bias lateral a 2.5 + `rawHistory` para evitar feedback desde proyecciones previas mal caidas.
- **SVG con personaje contaminaba el mask**: `extractGuideMaskFromImage` filtra por saturacion baja + descarta los N blobs mas grandes.
- **Trazados temblorosos / descentrados**: EMA sobre el cursor + proyeccion al soltar.
- **Placeholders MP3/PNG no significativos**: se dejo de empaquetar assets que el generador no puede producir. `thum.png` si se genera al exportar.
- **Navegacion Preview → Generador reiniciaba estado**: persistencia en `window.__generatorState` + `?step=N`.
- **Preview no podia terminar el trazado**: `box-sizing: content-box`, sin reset en mouseUp, hit radius `max(dotSize, 28)`.

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
    ...
  mayusculas/
    trazado-letra-a-mayus/
    ...
```

Componente consumidor: carga `data.json`, muestra outline como guia, dotted como puntos, usuario arrastra dragger por los puntos, al completar muestra fill. Soporta multi-stroke.

Pendiente de confirmar: tolerancia a la ausencia de `character.png`/`audio/*` (campos que siguen en el JSON pero sin archivos).

---

## Archivos clave del flujo actual

- `src/pages/GeneratorPage.jsx` — wizard
- `src/components/ManualPathDrawer.jsx` — canvas + proyeccion al soltar
- `src/utils/guideExtractor.js` — extraccion de polilinea + `snapToPolyline` / `projectStrokeOnGuide`
- `src/utils/letterMask.js` — fallback raster (distance transform)
- `src/utils/svgGenerator.js`, `dataGenerator.js`, `thumGenerator.js`, `exportUtils.js` — output
