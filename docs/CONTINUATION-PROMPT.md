# Prompt de Continuacion — Trazados Generator

Copia y pega este bloque al inicio de una nueva sesion para continuar el desarrollo:

---

## Contexto del proyecto

Estoy trabajando en **trazados-generator**, una app Vite + React que genera ejercicios interactivos de trazado de letras para una app educativa infantil. El proyecto esta en la carpeta seleccionada, dentro de `trazados-generator/`.

### Que hace la app
Genera todos los archivos necesarios (SVGs, data.json, audios placeholder, imagenes placeholder) para cada letra del abecedario español (27 letras + ch, ll), en dos variantes: **ligada** (cursiva minúsculas) y **mayúsculas**. Tiene 3 modos: desde tipografía (TTF/OTF/WOFF), desde SVGs importados, y trazado manual con el cursor.

### Stack
Vite 6 + React 18 + React Router 6 + opentype.js 1.3.4 + JSZip + file-saver

### Documentacion
Toda la documentacion tecnica esta en `trazados-generator/docs/`:
- `README.md` — Descripcion general, estructura, flujo de la app
- `UTILITIES.md` — Documentacion de todos los modulos utils (fontParser, pathSampler v2, svgGenerator, dataGenerator, exportUtils)
- `COMPONENTS.md` — Documentacion detallada de cada componente (GeneratorPage, PreviewPage, ManualPathDrawer, App, HomePage)
- `DATA-FORMATS.md` — Schemas de data.json y SVGs
- `PENDING-TASKS.md` — Tareas pendientes, problemas conocidos y resueltos

**Lee estos archivos antes de hacer cambios.** En particular `UTILITIES.md` y `COMPONENTS.md` tienen los detalles de cada funcion y su pipeline.

### Archivos clave
- `src/pages/GeneratorPage.jsx` (~800 lineas) — Wizard principal, logica de generacion con valores dinamicos
- `src/utils/pathSampler.js` — Algoritmo critico: esqueletonizacion Zhang-Suen a 2× resolucion, suavizado, sampling
- `src/utils/dataGenerator.js` — Generacion de data.json + funciones de calculo dinamico (computeLetterParams, computeDotCount)
- `src/utils/fontParser.js` — Parsing de fuentes + computeGlyphCanvasSize
- `src/pages/PreviewPage.jsx` — Preview interactivo del trazado
- `src/components/ManualPathDrawer.jsx` — Dibujo manual de trazos

### Lo que funciona
- Los 3 modos de generacion (font, SVG, manual) estan implementados
- Valores dinamicos por letra en modo font: canvas size, dotSize, strokeWidth, dotCount por trazo
- Patron de override: 0 = auto-compute, >0 = valor forzado por el usuario
- Algoritmo pathSampler v2: rasterizacion 2×, suavizado 4 iteraciones, merge colineal, filtrado ruido, Bezier cuadraticas
- Preview interactivo multi-stroke
- Exportacion ZIP individual y masiva
- El build compila sin errores (`npx vite build --outDir /tmp/trazados-dist`)

### Lo que falta (priorizado)
1. **Testing en navegador** (Alta): No se pudo probar en browser durante el desarrollo. Necesita verificacion de: modo font completo con valores dinamicos, path smoothness en preview, modo manual end-to-end, combos ch/ll, override de valores.
2. **Refinamiento de esqueletonizacion** (Media): Letras con serifas, letras muy gruesas/finas, ordenamiento de trazos para ciertas cursivas.
3. **Validacion de datos** (Media): Verificar schema de data.json, selectores #pathN, coords dentro de rango.
4. **Mejoras UX** (Baja): Preview miniatura en paso 4, edicion de trazos post-generacion, reordenamiento manual de trazos.

### Notas tecnicas importantes
- Estado se persiste en `window.__generatorState` (no Context/Redux)
- Paso actual en URL param `?step=N`
- Si hay problemas de permisos con `dist/`, usar `--outDir /tmp/trazados-dist`
- Todo el CSS esta en `App.css`
- No hay tests unitarios
- Datos de referencia del proyecto existente en `public/lecto_pruebas_2026/assets/trazados/` (58 data.json: 29 ligada + 29 mayusculas)

---
