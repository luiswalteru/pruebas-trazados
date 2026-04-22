# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Standalone Vite + React tool for generating interactive letter-tracing ("trazados") exercises for an educational infantil app. For each letter of the Spanish alphabet (plus `ch`, `ll`, and `ñ` → `ny` for folder names) it produces the two files the downstream React player needs that depend on the user's drawing: `data.json` + `base.svg`. Output ships in two variants: `ligada` (cursive lowercase) and `mayusculas` (uppercase).

The ilustrated assets that accompany each trazado (`bg.svg` background + `dotted.svg` dashed guide, and optionally character art / audio) are authored upstream and shipped by the content pipeline. This tool **consumes** `bg.svg` + `dotted.svg` as inputs to drive the drawing experience (visual guide + skeleton for snap), but does **not** re-emit them.

Destination path in the downstream app is `public/lecto_pruebas_2026/assets/trazados/{ligada|mayusculas}/trazado-letra-{name}/`.

## Commands

```bash
npm install
npm run dev       # Vite dev server on http://localhost:5173 (auto-opens)
npm run build     # Production build into dist/
npm run preview   # Preview the production build
```

No test suite, linter, or typecheck is configured. "Correctness" is validated by building, running the dev server, and exercising the wizard + PreviewPage manually.

If `dist/` has restrictive permissions (common on this workstation), build to a temp dir:

```bash
npx vite build --outDir /tmp/trazados-dist
```

## Architecture

### Two-SVG upload flow

Step 1 asks for **two SVGs per letter**, not one raster:

- **`bg.svg`** — the ilustration (coloured letter body, directional arrows, order number, decorative characters). Shown as a visual background, never inspected programmatically.
- **`dotted.svg`** — the dashed guide showing where the stroke should go. Shown on top of `bg.svg` as the visible trace guide, **and** rasterized internally to extract the skeleton the drawn strokes will snap to.

Older iterations accepted a single PNG with the letter body in near-white on a coloured background and extracted the skeleton from that white body. That flow is gone. The `'white-body'` mode of `extractGuideMaskFromImage` is still in the file but has no active callers — it's kept only so the parametrization of `extractGuideFromSvg` (`'any-opaque'` mode) doesn't require a full rewrite.

Older iterations also supported `font` (opentype.js skeletonization) and `svg-bundle` (upload fill/outline/dotted SVGs) modes. Both are gone — `src/utils/pathSampler.js` and `src/utils/fontParser.js` are dead code retained only as reference.

### Route layout

SPA with 3 routes (`react-router-dom` v6):

- `/` — `HomePage` (minimal landing with a single "Comenzar a Generar" link)
- `/generator` — `GeneratorPage` (3-step wizard: imagenes → trazado → exportar)
- `/preview` — `PreviewPage` (interactive preview that simulates the downstream player)

All styling lives in a single `src/App.css`. No CSS modules.

### The drawing pipeline (deferred snap)

`ManualPathDrawer` lets the user draw freely with the cursor. **The snap to the dotted guide runs once, on mouse release** — not per-sample. This was a deliberate change: per-sample snapping fought the user and occasionally teleported onto the wrong side of a cursive-letter loop.

Realtime (during drawing):

1. **EMA toward raw pointer** (`SMOOTH_ALPHA = 0.5`) — low-pass against hand jitter.
2. **Minimum-distance gate** (~1.2 px) — don't oversample.
3. Store point as-is. No snap, no mask lookup.

On `endStroke`:

- `adjustStrokeToGuide(points)` decides which adjuster to run based on the guide mode:
  - **`skeleton`** (polyline extracted from `dotted.svg`): `projectStrokeOnGuide(points, guide)` — snaps the first point to the nearest polyline endpoint if one is within 20 px, projects every subsequent point onto the nearest polyline segment with a **direction-aware lateral bias** (see below), snaps the last point to an endpoint if close, and runs two passes of neighbour-averaging to clean up sample-to-sample segment-switch jitter.
  - **`fallback`** (raster mask from `dotted.svg`, polyline extraction failed): `centerStrokePoints(points, maskInfo)` — the legacy iterative distance-transform pull.
  - **`none`** (no guide at all): stroke stored as-is.

**Direction-aware lateral bias** in `snapToPolyline` is the key to staying on the correct side when the polyline folds near itself (cursive "a", etc.):

- Motion direction is estimated from the **raw cursor path** (not the already-projected history — otherwise a single mis-projection becomes a feedback loop).
- Walk backwards through `rawHistory` accumulating arc length until ≥15 px; use that span's tangent.
- Score for a candidate projection = `d²(proj, cursor) + 2.5·lateral² + 0.4·max(0,−forward)²`, where forward/lateral are decomposed relative to the tip's direction. Forward motion is free; sideways jumps across the letter's body are heavily penalised.

At finalize time (`handleFinalize`): for each already-adjusted stroke, `resample` to `dotCount` equidistant points, mark corners (angle delta > π/4), `toFixed(3)` coords, `toFixed(0)` on the first point for the `dragger`. `strokePaths` are built separately with a lighter `smooth(_, 2)` for `base.svg`. **The drawer no longer emits `skeletonPaths`** (no `letter-dotted.svg` is produced any more).

### Skeleton extraction from `dotted.svg`

`extractGuideFromSvg(dottedSvg, width, height)` is a thin wrapper around `extractGuideMaskFromImage` with `mode: 'any-opaque'`:

1. Rasterize the SVG on a **transparent** canvas at 2× resolution (object-fit: contain).
2. Binarize: any pixel with `alpha >= 64` counts as guide (colour doesn't matter — `dotted.svg` typically has a single dark fill for all dashes).
3. Connected components, drop tiny specks (`minArea=20`, `minComponentRatio=0.05`).
4. **Aggressive morphological close** (`closePasses=4` — 4 dilate passes then 4 erode passes). Each dash becomes a blob, and closing merges adjacent blobs across the gaps between dashes so the rasterized dotted line becomes a **continuous filled curve** before thinning.
5. Zhang-Suen thinning → 1-pixel skeleton.
6. Prune spurs, extend endpoints (thinning shaves 1-2 px off each tip), build the centroid/edge graph, segment at junctions, merge near-collinear crossings, orient (top-first / left-first), sort top-left-first, smooth with 5 iterations, emit quadratic-bezier path `d` strings.

If extraction returns fewer than 3 centroids or no edges → fallback to `buildMaskFromImage(dottedSvg, ...)` (raster distance transform). If that also fails → `maskMode = 'none'`, stroke saved raw.

The "Ver guía" toggle in the drawer overlays the detected guide (cyan edges, dark-teal dots, orange endpoints) — useful when the skeleton has gaps or spurs in a new `dotted.svg` design. Thresholds to tune live in `guideExtractor.js`: `minAlpha`, `minArea`, `minComponentRatio`, `closePasses`, `renderScale`.

The drawer does **not** render a separate dashed overlay on top of the canvas — the uploaded `dotted.svg` itself is the visible guide, so "what the user sees while drawing" is exactly what they uploaded.

### `base.svg` contract

The downstream reader `fetch`es this file and injects it via `innerHTML` into a `<div>` to animate `#path1`, `#path2`, ... with `stroke-dashoffset`. Uses `<circle id="circle">` as the draggable marker and `<rect id="letterBg">` as the clickable background.

```xml
<svg class="svg-letter" width="100%" height="100%" viewBox="0 0 380 340">
  <rect id="letterBg" x="0" y="0" width="380" height="340"/>
  <path id="path1" class="svgPath" stroke-width="16" fill="none" d="M..."/>
  <path id="path2" class="svgPath" stroke-width="16" fill="none" d="M..."/>
  <circle id="circle" cx="190" cy="85" r="12"/>
</svg>
```

Contract:

- **No XML prolog, no DOCTYPE.** The reader injects via `innerHTML` inside a `<div>` — a prolog or external DOCTYPE inside a `<div>` is invalid HTML: the parser converts it into a bogus comment and subsequent CSS rules (`.svg-letter .svgPath`) fail to apply, leaving paths filled black (the "todo negro" bug).
- `<path id="path{i+1}" class="svgPath" stroke-width="S" fill="none" d="..."/>` per user stroke. `d` is `strokePaths[i].d` from `ManualPathDrawer.handleFinalize` (`M x,y L x,y ...` over `smooth(pts, 2)`).
- `stroke-width="S"` baked in from `effStroke` (= `animationPathStroke` in `data.json`).
- `fill="none"` inline as presentation-attribute fallback. The reader's CSS overrides; the inline is only a safety net.
- `<circle id="circle" cx cy r>` at the first point of the first stroke, `r = Math.ceil(stroke / 1.4)`.
- Static attribute names (`class`, `stroke-width`), not JSX.

### Export

`exportUtils.js` builds ZIPs with JSZip and triggers downloads via `file-saver`.

Each exported ZIP contains **only** two files per letter:

- `data.json`
- `base.svg`

`letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `thum.png`, `character.png`, `fondo.png` and the audio files are **no longer emitted** by this tool — the content pipeline ships them alongside our output. The `data.json` shape, however, still matches `ejemplo/trazado-letra-a/data.json` exactly, including the `character` / `letterFill` / `letterOutline` / `letterDotted` / `title.audio.{es,val}` pointers. Dropping those fields breaks the reader even if the files they point to aren't produced here; they're pointers the reader resolves against the deployed bundle.

### Dev-server reader preview

`writeTrazadoToReader` POSTs to `/__write-reader-trazado` (middleware registered in `vite.config.js`) with `{ type, folderName, files: { 'data.json', 'base.svg' } }`. The middleware writes to `public/reader/libro/assets/trazados/{type}/{folderName}/`. Only works in `npm run dev`.

### Dynamic per-letter values

Canvas size is **not** auto-computed — it's whatever the user configures in Step 2 (default 380 × 340). Only `dotSize` and `animationPathStroke` have auto-compute:

- `computeLetterParams(letter, type, canvasW)` returns `{ dotSize, animationPathStroke }` based on canvas width buckets + letter-specific overrides for `e`, `i`, `k`, `m`, `n`, `u`, `p` (ligada) and `canvasW > 240/350` thresholds (mayusculas). Values come from the original `lecto_pruebas_2026` project's tuning.

**Override convention** (important for `GeneratorPage` inputs): `0 = auto-compute, >0 = user forces this value`. Canvas w/h don't have this convention — any user value is used directly.

### SVG ID contract

The reader selects on these ids — they're not stylistic:

- `base.svg` → `<rect id="letterBg">`, `<path id="pathN" class="svgPath">` per stroke, `<circle id="circle">`.
- `data.json.letterAnimationPath[i].selector` → `#path1`, `#path2`, ... must line up 1:1 with the `<path id="pathN">` ids in `base.svg` and the `dotList[i]` entries.

Stroke index `i` in `dotList` → animation entry `letterAnimationPath[i]` → base.svg path `#path{i+1}`. The generator sets all three from the user's stroke drawing order, so they stay in sync as long as nothing reorders the `strokePaths` array.

### State persistence across navigation

The wizard's full state is mirrored into `window.__generatorState` (not Context, not Redux) via an always-running `useEffect` inside `GeneratorPage.jsx`, and the current step is kept in the URL as `?step=N`. The `images` state in particular has shape `{ [letter]: { bg: dataURL, dotted: dataURL } }` — preserve that shape when touching Step 1 or persistence. Preview data is passed to `/preview` through `window.__trazadoPreview` and includes `bgSvg` + `dottedSvg` so the preview reproduces the same visual backdrop the user drew on.

### Compound letters (`ch`, `ll`) and ñ

- The user draws compounds as a sequence of strokes like any other letter — the app no longer composes glyphs automatically from a font.
- In `data.json` the `letter` field uses the raw lowercase string for ligada (`"a"`, `"ch"`, `"ll"`, `"ñ"`) and `"Upper" + Capitalized` for mayusculas (`"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"`). **Note the ñ mismatch**: folder names go through `getFolderName` and become `ny` / `-mayus`, but the `letter` field is not mapped to `"ny"` / `"UpperNy"`. Check downstream expectations before relying on either.

### Letter selection

In Step 1 the user can only pick **one letter at a time** (`toggleLetter` clears the array rather than appending). Treat `selectedLetters` as `string[]` of length 0 or 1. Bulk generation still works at the loop level in `handleGenerate`, so single-letter restriction is just a UI choice — the underlying generation code has no such limit.

## Conventions worth knowing

- ES modules (`"type": "module"`). JSX uses the automatic runtime via `@vitejs/plugin-react`.
- No TypeScript; JSDoc on hot spots. Don't introduce TS without discussing.
- `docs/` (README, DATA-FORMATS, UTILITIES, COMPONENTS, PENDING-TASKS) is the source of truth for output schemas and behavior. Update those docs when changing data shapes or the drawing pipeline.
- `ejemplo/trazado-letra-a/bg.svg` and `ejemplo/trazado-letra-a/dotted.svg` are the **canonical reference inputs**: exactly what the user is expected to upload in Step 1. The rest of that folder (`character.png`, `fondo.png`, audio files, `letter-fill.svg`, `letter-outline.svg`, `letter-dotted.svg`, `thum.png`) is a **historical** output bundle from an earlier generator version and does **not** match current export — it's kept only for reference.

## Known dead code

After the two-SVG-upload refactor, the following modules/functions have no active callers. They still compile and are tree-shaken out of the production bundle, but can be removed cleanly if you're doing cleanup:

- **`src/utils/thumGenerator.js`** — generated `thum.png` by rasterizing fill+dotted. No `thum.png` in the export now.
- **`src/utils/svgGenerator.js`** except `generateBaseSvg` — `generateFillSvg`, `generateFillSvgFromStrokes`, `generateOutlineSvg`, `generateOutlineSvgFromStrokes`, `generateDottedSvg` were for the removed `letter-fill/outline/dotted.svg` emission.
- **`src/utils/fontParser.js`** — opentype.js font flow. Gone before the two-SVG refactor.
- **`src/utils/pathSampler.js`** — Zhang-Suen + resample + bezier paths. Replaced by `guideExtractor`'s centerline segmentation.
- **`letterMask.buildLetterMask`** — accepts an SVG content string. No callers.
- **`dataGenerator.computeDotCount`** — the UI uses a fixed user-configured `dotCount`.
- **`extractGuideMaskFromImage` with `mode: 'white-body'`** — legacy PNG entry point. No callers (everything goes through `extractGuideFromSvg` now). Could collapse the two modes into one.
