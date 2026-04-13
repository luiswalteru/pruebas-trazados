# Trazados Generator - Documentacion del Proyecto

## Descripcion General

Aplicacion standalone Vite + React para generar ejercicios interactivos de trazado de letras ("trazados") para una app educativa infantil React. Genera todos los archivos necesarios (SVGs, data.json, audios, imagenes) para cada letra del abecedario espanol, en dos variantes: **ligada** (cursiva minusculas) y **mayusculas**.

## Instalacion y Ejecucion

```bash
cd trazados-generator
npm install
npm run dev      # Servidor de desarrollo en http://localhost:5173
npm run build    # Build de produccion
npm run preview  # Preview del build de produccion
```

**Nota sobre build**: Si hay errores de permisos al escribir en `dist/`, usar:
```bash
npx vite build --outDir /tmp/trazados-dist
```

## Stack Tecnologico

- **Vite 6** + **@vitejs/plugin-react** - Bundler y HMR
- **React 18** + **React Router DOM 6** - UI y navegacion SPA
- **opentype.js 1.3.4** - Parsing de fuentes TTF/OTF/WOFF y extraccion de glifos
- **JSZip 3.10.1** - Generacion de archivos ZIP
- **file-saver 2.0.5** - Descarga de archivos desde el navegador

## Estructura del Proyecto

```
trazados-generator/
  index.html
  package.json
  vite.config.js
  docs/                           # Documentacion del proyecto
    README.md                     # Este archivo
    DATA-FORMATS.md               # Schemas de data.json y SVGs
    UTILITIES.md                  # Documentacion de utilidades
    COMPONENTS.md                 # Documentacion de componentes
    PENDING-TASKS.md              # Tareas pendientes y problemas
  src/
    main.jsx                      # Entry point con BrowserRouter
    App.jsx                       # Layout principal con navegacion
    App.css                       # Estilos globales de toda la app
    pages/
      HomePage.jsx                # Landing page con links
      GeneratorPage.jsx           # Wizard principal de 4 pasos (~800 lineas)
      PreviewPage.jsx             # Preview interactivo del trazado
    components/
      ManualPathDrawer.jsx        # Componente de dibujo manual de trazos
    utils/
      fontParser.js               # Parsing de fuentes + calculo de canvas size dinamico
      pathSampler.js              # Esqueletonizacion 2x, suavizado, sampling de puntos
      svgGenerator.js             # Generacion de SVGs (fill, outline, dotted)
      dataGenerator.js            # Generacion de data.json + calculo dinamico de params
      exportUtils.js              # Exportacion ZIP con JSZip
```

## Flujo de la Aplicacion

### GeneratorPage - Wizard de 4 Pasos

**Paso 1: Seleccionar origen** - Tres modos disponibles (grid 3 columnas):
1. **Desde Tipografia** (`mode='font'`): Cargar archivo TTF/OTF/WOFF. Se usa opentype.js para extraer los glifos.
2. **Desde SVG** (`mode='svg'`): Importar SVGs manuales (fill, outline, dotted) por cada letra.
3. **Trazado Manual** (`mode='manual'`): Dibujar el recorrido de cada trazo con el cursor. Opcionalmente carga una fuente de referencia visual.

**Paso 2: Seleccionar tipo y letras** - Elegir entre "ligada" o "mayusculas", y seleccionar las letras a generar (27 letras + ch, ll).

**Paso 3: Configurar y generar** - Parametros configurables (todos editables):
- Ancho/alto del canvas — en modo font se calcula automaticamente si se deja en 380/340, o se puede forzar un valor fijo
- Cantidad de puntos por trazo — auto (0) calcula segun longitud del trazo, o se fija un valor
- Tamano de punto / dotSize — auto (0) calcula segun tipo y ancho, o se fija un valor
- Grosor del trazo de animacion — auto (0) calcula segun tipo, o se fija un valor
- En modo SVG: subir SVGs por letra
- En modo manual: dibujar trazos por letra con ManualPathDrawer

**Paso 4: Assets y exportacion** - Ver trazados generados con valores computados por letra (canvas, dotSize, stroke, puntos por trazo), subir assets opcionales (audios, imagenes), preview individual, exportar individual o masivo como ZIP.

### Valores Dinamicos (modo font)

En modo tipografia, los valores se calculan automaticamente para cada letra imitando los patrones del proyecto existente `lecto_pruebas_2026`:

| Parametro | Ligada | Mayusculas | Como se calcula |
|-----------|--------|------------|-----------------|
| Ancho canvas | 157–600 px | 95–440 px | Aspect ratio natural del glifo |
| Alto canvas | ~340 px | ~315 px | Fijo por tipo |
| dotSize | 26–40 | 33–40 | Basado en ancho del canvas + overrides por letra |
| animationPathStroke | 10–18 | 10–12 | Basado en tipo y ancho |
| Puntos por trazo | 2–84 | 3–37 | ~1 punto cada 6.5 px de longitud del trazo |

El usuario puede forzar cualquier valor ingresando un numero > 0 en el campo correspondiente.

### Persistencia de Estado

El estado del generador se persiste en `window.__generatorState` para sobrevivir la navegacion entre paginas (ir a Preview y volver). El paso actual se lee/escribe en el URL param `?step=N`.

### PreviewPage - Preview Interactivo

Simula el trazado real como lo haria el componente React de la app educativa:
- Muestra el SVG outline como guia, el dotted como referencia de puntos
- El usuario hace click para iniciar, luego mueve el cursor por los puntos
- Hit radius generoso: `max(dotSize, 28)` px
- Multi-stroke: al completar un trazo avanza al siguiente
- Al completar todo: muestra el fill SVG con animacion fade-in
- Modo debug: visualiza todos los dots, distancias, coordenadas

## Estructura de Salida por Letra

Cada letra genera una carpeta con esta estructura:

```
trazado-letra-{nombre}/
  data.json               # Datos del trazado (dotList, metadata)
  letter-fill.svg         # SVG con la letra rellena (path id="fill")
  letter-outline.svg      # SVG con el contorno (path id="contorno")
  letter-dotted.svg       # SVG con path punteado de la linea central (group id="path")
  character.png           # Imagen del personaje (placeholder si no se sube)
  thum.png                # Thumbnail (placeholder si no se sube)
  fondo.png               # Imagen de fondo (placeholder si no se sube)
  audio/
    es/
      title.mp3           # Audio del titulo en espanol (silent placeholder si no se sube)
    val/
      title.mp3           # Audio del titulo en valenciano (silent placeholder si no se sube)
```

### Nombrado de Carpetas

- Ligada: `trazado-letra-a`, `trazado-letra-b`, ..., `trazado-letra-ny` (para n), `trazado-letra-ch`, `trazado-letra-ll`
- Mayusculas: `trazado-letra-a-mayus`, `trazado-letra-b-mayus`, ...

### Exportacion Masiva

Al exportar todas, se agrupan bajo una carpeta con el tipo:
```
ligada/
  trazado-letra-a/
  trazado-letra-b/
  ...
```
o
```
mayusculas/
  trazado-letra-a-mayus/
  ...
```
