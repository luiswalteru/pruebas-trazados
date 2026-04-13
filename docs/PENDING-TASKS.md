# Tareas Pendientes y Problemas Conocidos

## Estado actual del proyecto

El proyecto compila correctamente (`npx vite build` exitoso). Las tres modalidades de generacion (font, SVG, manual) estan implementadas. El algoritmo de esqueletonizacion fue reescrito como v2 con rasterizacion 2×, suavizado, merge de segmentos y filtrado de ruido. Los valores (canvas size, dotSize, strokeWidth, dotCount) se computan dinamicamente por letra en modo font.

---

## Tareas pendientes

### 1. Testing en navegador
**Prioridad: Alta**

La extension Chrome no estuvo disponible durante el desarrollo. Todo fue verificado via build exitoso y revision de codigo. Necesita testing manual:

- [ ] **Modo font completo**: Cargar fuente -> seleccionar letras -> generar -> verificar valores dinamicos por letra -> preview -> exportar
- [ ] **Valores dinamicos**: Verificar que canvas size, dotSize, strokeWidth y dotCount varian correctamente por letra
- [ ] **Override de valores**: Verificar que ingresar un valor > 0 fuerza ese valor en lugar del auto-computado
- [ ] **Path smoothness**: Verificar que los trazos generados son suaves (sin saltos) en el PreviewPage tras pathSampler v2
- [ ] **Modo manual end-to-end**: Dibujar trazos -> generar -> preview -> exportar
- [ ] **Atajos de teclado modo manual** (N, Ctrl+Z, Enter, Escape)
- [ ] **Modo SVG**: Importar SVGs -> generar -> preview -> exportar
- [ ] **Combos (ch, ll)**: Verificar que el offset horizontal y anchos individuales se calculan bien

### 2. Refinamiento del algoritmo para letras problematicas
**Prioridad: Media**

El algoritmo v2 mejoro significativamente la calidad, pero puede haber casos edge:
- Letras con serifas pueden generar ramas espurias residuales
- Letras muy gruesas o muy finas pueden no esqueletonizar bien
- El ordenamiento de trazos "top->bottom, left->right" puede no ser correcto para todas las letras cursivas (ej: la "e" cursiva podria necesitar un orden especifico)

**Posibles mejoras**:
- Permitir al usuario reordenar trazos manualmente en la UI
- Modo hibrido: auto-generar con esqueleto pero permitir ajustes manuales
- Ajustar MIN_SEGMENT_RATIO (actualmente 8%) si se encuentran letras con ruido residual

### 3. Validacion de datos generados
**Prioridad: Media**

- [ ] Validar que data.json cumple el schema esperado por el componente React de la app educativa
- [ ] Verificar que los selectores `#path1`, `#path2` en letterAnimationPath coinciden con los IDs reales en letter-dotted.svg
- [ ] Verificar que los coords en dotList estan dentro del rango [0, width] y [0, height]

### 4. Mejoras de UX
**Prioridad: Baja**

- [ ] Mostrar preview en miniatura de los SVGs generados en el paso 4
- [ ] Permitir editar/ajustar trazos generados automaticamente antes de exportar
- [ ] Indicador de progreso durante generacion masiva
- [ ] Drag & drop para subir archivos de fuente y SVGs
- [ ] Permitir reordenar trazos manualmente

---

## Problemas resueltos

### Resuelto: Modo manual no visible en Step 3
**Causa**: CSS `.mode-selector` tenia `grid-template-columns: 1fr 1fr` (2 columnas) en lugar de 3.
**Solucion**: Cambiado a `1fr 1fr 1fr` en App.css.

### Resuelto: Trazados imprecisos — saltos entre puntos en preview
**Causa**: Rasterizacion a 1× resolucion producia esqueletos con zigzag pixel a pixel. Sin suavizado previo al resampleo.
**Solucion**: pathSampler.js v2 con RASTER_SCALE=2, smoothing 4 iteraciones antes de resampleo, merge de segmentos colineales (angulo < 30°), filtrado de ruido (< 8% del mas largo), Bezier cuadraticas para SVG paths.

### Resuelto: Valores fijos para todas las letras
**Causa**: Se usaban los mismos valores (380×340, dotSize 33, etc.) para todas las letras.
**Solucion**: Implementado calculo dinamico por letra: `computeGlyphCanvasSize`, `computeLetterParams`, `computeDotCount`. Patron 0 = auto, >0 = override del usuario.

### Resuelto: Inputs de configuracion deshabilitados en modo font
**Causa**: Panel de config tenia `opacity: 0.5, pointerEvents: 'none'` en modo font.
**Solucion**: Removido. Todos los inputs siempre habilitados. El usuario puede forzar valores ingresando > 0.

### Resuelto: Navegacion Preview -> Generador reiniciaba estado
**Solucion**: Persistencia en `window.__generatorState` + URL param `?step=N`.

### Resuelto: Trazado en el borde en lugar del interior
**Solucion**: Implementado Zhang-Suen thinning para extraer linea central.

### Resuelto: Direccion de trazado incorrecta
**Solucion**: Junction detection + heuristicas de orientacion + ordenamiento global.

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

Componente React destino: carga data.json, muestra outline como guia, dotted como puntos, usuario arrastra dragger por los puntos, al completar muestra fill SVG. Soporta multi-stroke.

---

## Notas para continuar el desarrollo

1. **Iniciar servidor dev**: `npm run dev` en `trazados-generator/`
2. **Archivo mas complejo**: `GeneratorPage.jsx` (~800 lineas)
3. **Algoritmo critico**: `pathSampler.js` — esqueletonizacion v2 y muestreo
4. **Estado global**: `window.__generatorState` (no Context ni Redux)
5. **No hay tests unitarios** — todo se ha probado via build y revision de codigo
6. **CSS**: Todo en `App.css`, no hay CSS modules
7. **Patron de override**: 0 = auto-compute, >0 = valor forzado por el usuario
