# Tareas Pendientes y Problemas Conocidos

## Estado actual del proyecto

Tras el **refactor manual-only (abril 2026)** el proyecto se simplifico considerablemente:
- Se eliminaron los modos `font` y `svg` de la UI. El unico flujo activo es dibujo manual.
- Se añadio auto-centrado del cursor al eje medial de la letra (`letterMask.js` + `snapToCenterline` en `ManualPathDrawer`).
- `letter-dotted.svg` pasa a emitirse como `<g id="pathN">` con `<circle>`s por coordenada (antes eran paths con `stroke-dasharray`).
- `thum.png` se genera automaticamente al exportar (rasteriza fill + dots).
- Se dejaron de exportar `character.png`, `fondo.png`, `audio/es/title.mp3` y `audio/val/title.mp3` (ni siquiera como placeholders).
- `src/utils/pathSampler.js` y varias funciones de `fontParser.js` quedaron **sin usar** pero se conservan en el repo.

---

## Tareas pendientes

### 1. Resolver campos huerfanos en `data.json`
**Prioridad: Alta**

`generateDataJson` sigue escribiendo:
- `character: "character.png"`
- `title.audio.es: "audio/es/title"`, `title.audio.val: "audio/val/title"`

Pero esos archivos **ya no se incluyen en el ZIP**. Opciones:
- [ ] Dejar de emitir esos campos cuando no hay los assets (romperia cualquier consumidor que los espere no-null)
- [ ] Reintroducir uploads opcionales de imagen/audio en el paso 4 + placeholders
- [ ] Confirmar que el componente consumidor los puede manejar como missing/placeholder

### 2. Desajuste en el campo `letter` para ñ
**Prioridad: Media**

- `getFolderName` mapea `ñ` → `ny` (carpeta = `trazado-letra-ny` / `trazado-letra-ny-mayus`)
- `generateDataJson` escribe el campo `letter` como `"ñ"` / `"UpperÑ"` (sin mapeo)

Si el componente consumidor espera `"ny"` / `"UpperNy"` en el campo `letter`, hay que ajustar uno de los dos lados.

### 3. Testing manual en navegador
**Prioridad: Alta**

- [ ] Dibujar trazados end-to-end sin fuente de referencia
- [ ] Idem con fuente de referencia (verificar auto-centrado via `snapToCenterline`)
- [ ] Preview reproduce correctamente los trazados generados
- [ ] Atajos de teclado en `ManualPathDrawer` (N, Ctrl+Z, Enter, Esc)
- [ ] Export individual + masivo (verificar que los ZIPs incluyen solo los 4 archivos correctos + `thum.png`)
- [ ] Override de `dotSize` / `animationPathStroke` (0 vs >0)
- [ ] Combos (`ch`, `ll`) se manejan bien incluso sin fuente de referencia (el fallback `generateFillSvgFromStrokes` dibuja algo razonable?)

### 4. Decisiones sobre codigo muerto
**Prioridad: Baja**

- [ ] Eliminar `src/utils/pathSampler.js` si no se planea reintroducir el modo font
- [ ] Eliminar `computeGlyphCanvasSize` y `getAvailableChars` de `fontParser.js` si se confirma que no se usan
- [ ] Eliminar `computeDotCount` de `dataGenerator.js` si se confirma que no se usa en la UI actual

### 5. Ajustes del contrato con el componente consumidor
**Prioridad: Media**

Resuelto para `letter-dotted.svg`: se revirtio a paths dasheados (`stroke-dasharray: 0.1,16`) con el wrapper `<g id="path">`, que es el contrato que espera el componente educativo. Pendiente:
- [ ] Validar que el `stroke-width` que se emite (= `animationPathStroke` efectivo) produce el tamaño de punto esperado. Si no, ajustar el argumento que pasa `GeneratorPage.generateForLetter` a `generateDottedSvg`.

### 6. Mejoras de UX (baja)
- [ ] Indicador de progreso durante generacion masiva
- [ ] Preview en miniatura de los SVGs en el paso 4
- [ ] Permitir reordenar trazos manualmente (hoy el orden viene dado por el orden de dibujo)

---

## Problemas resueltos

### Resuelto: App sobrecomplicada con 3 modos
**Solucion**: Refactor a manual-only. Paso 1 ahora es solo intro + carga opcional de fuente de referencia. Se eliminaron todos los handlers de SVG upload e import, y la dependencia de `pathSampler.js`.

### Resuelto: Trazados temblorosos / descentrados al dibujar
**Solucion**: Pipeline de captura en `ManualPathDrawer` con:
1. EMA sobre el cursor (`SMOOTH_ALPHA = 0.5`)
2. Gate de distancia minima (1.2 px)
3. `snapToCenterline` usando el gradiente del campo de distancia de la mascara del fill (distance transform chamfer 3-4 en `letterMask.js`). La correccion es radial hacia el esqueleto y se atenua a 0 cuando el punto ya esta centrado.

### Resuelto: Placeholders MP3/PNG no significativos
**Solucion**: Se dejo de empaquetar assets que el generador no puede producir. `thum.png` si se genera auto-rasterizando fill + dots en `thumGenerator.js`.

### Resuelto: Inputs de configuracion deshabilitados en modo font
**Solucion**: Modo font eliminado. Todos los inputs siempre habilitados.

### Resuelto: Navegacion Preview -> Generador reiniciaba estado
**Solucion**: Persistencia en `window.__generatorState` + URL param `?step=N`.

### Resuelto: Preview no podia terminar el trazado
**Solucion**: `box-sizing: content-box`, eliminado reset agresivo en mouseUp, hit radius `max(dotSize, 28)`, fix closure stale.

### Conocido: Permisos de npm en sandbox
Warnings durante `npm install` sobre rollup platform-specific. Inofensivos.

### Conocido: Build requiere outDir alternativo
Si `dist/` tiene permisos restrictivos, usar `--outDir /tmp/trazados-dist`.

---

## Contexto del proyecto destino

Los trazados generados se integran en:
```
public/lecto_pruebas_2026/assets/trazados/
  ligada/
    trazado-letra-a/
    ...
  mayusculas/
    trazado-letra-a-mayus/
    ...
```

Componente React destino: carga `data.json`, muestra outline como guia, dotted como puntos, usuario arrastra dragger por los puntos, al completar muestra fill SVG. Soporta multi-stroke.

**Pendiente de confirmar** (ver "Ajustes del contrato" arriba): si el componente soporta el nuevo formato de `letter-dotted.svg` (circles-per-coord), y si tolera la ausencia de `character.png`/`audio/*`.

---

## Notas para continuar el desarrollo

1. **Iniciar servidor dev**: `npm run dev`
2. **Archivos clave del flujo actual**: `GeneratorPage.jsx`, `ManualPathDrawer.jsx`, `letterMask.js`, `svgGenerator.js`, `exportUtils.js`, `thumGenerator.js`
3. **Codigo legacy**: `pathSampler.js` y `computeGlyphCanvasSize`/`getAvailableChars` de `fontParser.js` no se usan
4. **Estado global**: `window.__generatorState` (no Context ni Redux), `window.__trazadoPreview` (paso a Preview)
5. **No hay tests unitarios** — se valida via build + uso manual
6. **CSS**: Todo en `App.css`, sin CSS modules
7. **Patron de override**: `0 = auto`, `>0 = forzado`, para `dotSize` y `animationPathStroke`
