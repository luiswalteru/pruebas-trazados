# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Standalone Vite + React tool for generating interactive letter-tracing ("trazados") exercises for an educational infantil app. For each letter of the Spanish alphabet (plus `ch`, `ll`, and `ñ` → `ny` for folder names) it produces the bundle consumed by the downstream React player: `data.json`, three SVGs (`letter-fill`, `letter-outline`, `letter-dotted`), and an auto-generated `thum.png`. Output ships in two variants: `ligada` (cursive lowercase) and `mayusculas` (uppercase).

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

### Manual drawing over an SVG reference scene

The app is manual-only. The user uploads one reference image per letter (recommended: an `.svg` illustration that contains the letter body, the dotted tracing guide, and decorative character art — see `ejemplo/trazado-letra-a/a_correct.svg`) and hand-draws the tracing path over it. Raster images (PNG/JPG) still work as a fallback.

Older versions supported `font` (opentype.js skeletonization) and `svg-bundle` (upload fill/outline/dotted SVGs) modes. Both are gone — `src/utils/pathSampler.js` and most of `src/utils/fontParser.js` are dead code retained only as reference.

A loaded reference image has these effects:
1. Rendered under the drawing canvas as a visual guide (40% opacity).
2. If the file is SVG: passed through `guideExtractor.extractGuideMaskFromImage`, which rasterizes it at 2× canvas resolution, thresholds dark low-saturation pixels (excluding the character's vivid colors), runs 8-connectivity flood-fill to find blobs, discards the 3 largest (letter body + character silhouettes) and the excessively small ones, keeps the rest as "guide dots", and builds a polyline from their centroids (K=2 nearest neighbors with a ~2.5× median distance cap). That polyline is what drawn strokes snap to.
3. If the file is raster (PNG/JPG) or SVG extraction fails (fewer than 3 dots detected): falls back to `buildMaskFromImage`, a plain dark-pixel mask + distance transform — same as the pre-SVG flow.

### Route layout

SPA with 3 routes (`react-router-dom` v6):
- `/` — `HomePage` (minimal landing with a single "Comenzar a Generar" link)
- `/generator` — `GeneratorPage` (3-step wizard: imagen → trazado → exportar)
- `/preview` — `PreviewPage` (interactive preview that simulates the downstream player)

All styling lives in a single `src/App.css`. No CSS modules.

### The drawing pipeline (deferred snap)

`ManualPathDrawer` lets the user draw freely with the cursor. **The snap to the dotted guide runs once, on mouse release** — not per-sample. This was a deliberate change: per-sample snapping felt fought the user and occasionally teleported onto the wrong side of a cursive-letter loop.

Realtime (during drawing):
1. **EMA toward raw pointer** (`SMOOTH_ALPHA = 0.5`) — low-pass against hand jitter.
2. **Minimum-distance gate** (~1.2 px) — don't oversample.
3. Store point as-is. No snap, no mask lookup.

On `endStroke`:
- `adjustStrokeToGuide(points)` decides which adjuster to run based on the guide mode:
  - **`svg-dots`** (polyline available): `projectStrokeOnGuide(points, guide)` — snaps the first point to the nearest polyline endpoint if one is within 50 px, projects every subsequent point onto the nearest polyline segment with a **direction-aware lateral bias** (see below), snaps the last point to an endpoint if close, and runs two passes of neighbour-averaging to clean up sample-to-sample segment-switch jitter.
  - **`fallback`** (raster mask, no polyline): `centerStrokePoints(points, maskInfo)` — the legacy iterative distance-transform pull.
  - **`none`** (no guide at all): stroke stored as-is.

**Direction-aware lateral bias** in `snapToPolyline` is the key to staying on the correct side when the polyline folds near itself (cursive "a", etc.):
- Motion direction is estimated from the **raw cursor path** (not the already-projected history — otherwise a single mis-projection becomes a feedback loop).
- Walk backwards through `rawHistory` accumulating arc length until ≥15 px; use that span's tangent.
- Score for a candidate projection = `d²(proj, cursor) + 2.5·lateral² + 0.4·max(0,−forward)²`, where forward/lateral are decomposed relative to the tip's direction. Forward motion is free; sideways jumps across the letter's body are heavily penalised.

At finalize time (`handleFinalize`): for each already-adjusted stroke, `resample` to `dotCount` equidistant points, mark corners (angle delta > π/4), `toFixed(3)` coords, `toFixed(0)` on the first point for the `dragger`. `strokePaths` are built separately with a lighter `smooth(_, 2)` for `letter-dotted.svg` and `thum.png`.

The "Ver guía" toggle in the drawer overlays the detected guide (cyan edges, dark-teal dots, orange endpoints) — useful when the segmentation misses points or includes too many; there is no fine-grained slider UI yet, so tuning means editing the defaults in `guideExtractor.js`.

### `letter-dotted.svg` contract

The downstream player expects **dashed paths**, one `<path id="path{i+1}">` per stroke, inside a `<g id="path">` wrapper:

```xml
<g><g><g id="path">
  <path id="path1" d="M... L..." style="fill:none;stroke:#ccc;stroke-width:5px;stroke-linecap:round;stroke-dasharray:7,11;"/>
  <path id="path2" .../>
</g></g></g>
```

- The `d` values come from `ManualPathDrawer.handleFinalize`'s `strokePaths` output — simple `M + L` paths built from smoothed stroke points.
- `letterAnimationPath[i].selector` (`#path1`, `#path2`, …) targets the individual `<path>` elements inside the wrapper.
- **The dashing must render as actual dashes, not round dots.** The reference bundle (`ejemplo/trazado-letra-a/letter-dotted.svg`) uses capsule-shaped dashes of ~12×5 px with period 18. We reproduce that with `stroke-width: 5` + `stroke-dasharray: 7,11` + `stroke-linecap: round` — the round caps extend the 7-unit dash into a visible 12-unit capsule and shrink the 11-unit gap into a 6-unit visible gap (period 18, matching the reference).
- Do **not** set the dash length to `0.1` — that renders as round dots, which is the wrong visual. Any dash ≥ ~5 with round caps produces proper dashes.
- `animationPathStroke` from `data.json` is **not** reused for this stroke-width. That value drives the animated trail on the consumer side; the dashed guide has its own fixed thickness.

`generateDottedSvg`'s signature is `(strokePaths, width, height, strokeWidth = 5, dashArray = '7,11')`. `GeneratorPage` just passes the first three and relies on the defaults.

### Export

`exportUtils.js` builds ZIPs with JSZip and triggers downloads via `file-saver`. **Now async** — it generates `thum.png` on the fly via `thumGenerator.generateThumPngBlob` (rasterizes fill + dots onto a canvas and calls `canvas.toBlob`).

Each exported ZIP contains **only** these files:
- `data.json`
- `letter-fill.svg`
- `letter-outline.svg`
- `letter-dotted.svg`
- `thum.png`

Historical placeholders (silent MP3, 1×1 transparent PNG) and the `character.png`/`fondo.png`/`audio/es/title.mp3`/`audio/val/title.mp3` files are **no longer emitted**. `generateDataJson` still writes `character: "character.png"` and `title.audio.{es,val}: "audio/{es,val}/title"` fields, but the referenced files are not in the ZIP — this is an open contract issue tracked in `PENDING-TASKS.md`.

### Dynamic per-letter values (what's left of it)

Canvas size is **no longer** auto-computed — it's whatever the user configures in Step 3 (default 380 × 340). Only `dotSize` and `animationPathStroke` have auto-compute:

- `computeLetterParams(letter, type, canvasW)` returns `{ dotSize, animationPathStroke }` based on canvas width buckets + letter-specific overrides for `e`, `i`, `k`, `m`, `n`, `u`, `p` (ligada) and `canvasW > 240/350` thresholds (mayusculas). Values come from the original `lecto_pruebas_2026` project's tuning.

**Override convention** (important for `GeneratorPage` inputs): `0 = auto-compute, >0 = user forces this value`. Canvas w/h don't have this convention — any user value is used directly.

### SVG ID contract (consumed by the downstream player)

These are not stylistic — the player selects on these ids.

- `letter-fill.svg` — `<path id="fill">` (reference-font path) OR `<path id="fill1">`, `fill2`, ... (stroke-based fallback)
- `letter-outline.svg` — `<path id="contorno">` OR `<path id="contorno1">`, ...
- `letter-dotted.svg` — `<g id="path1">`, `<g id="path2">`, ... (one per stroke, indices must line up with `letterAnimationPath[i].selector`)

All three share `viewBox="0 0 {width} {height}"` matching `letterSize` in `data.json`.

### State persistence across navigation

The wizard's full state is mirrored into `window.__generatorState` (not Context, not Redux) via an always-running `useEffect` inside `GeneratorPage.jsx`, and the current step is kept in the URL as `?step=N`. Preview data is passed to `/preview` through `window.__trazadoPreview`. When editing `GeneratorPage`, preserve both mechanisms — leaving and returning to `/generator` must restore exactly where the user was.

### Compound letters (`ch`, `ll`) and ñ

- The user draws compounds as a sequence of strokes like any other letter — the app no longer composes glyphs automatically from a font.
- In `data.json` the `letter` field uses the raw lowercase string for ligada (`"a"`, `"ch"`, `"ll"`, `"ñ"`) and `"Upper" + Capitalized` for mayusculas (`"UpperA"`, `"UpperCh"`, `"UpperLl"`, `"UpperÑ"`). **Note the ñ mismatch**: folder names go through `getFolderName` and become `ny` / `-mayus`, but the `letter` field is not mapped to `"ny"` / `"UpperNy"`. Check downstream expectations before relying on either.

### Letter selection

In Step 2 the user can only pick **one letter at a time** (`toggleLetter` clears the array rather than appending). Treat `selectedLetters` as `string[]` of length 0 or 1. Bulk generation still works at the loop level in `handleGenerate`, so single-letter restriction is just a UI choice — the underlying generation code has no such limit.

## Conventions worth knowing

- ES modules (`"type": "module"`). JSX uses the automatic runtime via `@vitejs/plugin-react`.
- No TypeScript; JSDoc on hot spots. Don't introduce TS without discussing.
- `docs/` (README, DATA-FORMATS, UTILITIES, COMPONENTS, PENDING-TASKS) is the source of truth for output schemas and behavior. Update those docs when changing data shapes or the drawing pipeline.
- `ejemplo/trazado-letra-a/` is a **historical** reference bundle showing the pre-refactor output shape (with `character.png`, `fondo.png`, audio files, dashed `letter-dotted.svg`). It does **not** match current generator output — use it only to understand what the downstream player may have expected before.

## Known dead code

- **`src/utils/pathSampler.js`** is no longer imported anywhere. Kept as reference (Zhang-Suen thinning, junction detection, colinear merge, resample, Bezier path construction).
- **`src/utils/fontParser.js`** is no longer imported anywhere either — the old reference-font flow is gone entirely. Kept only as reference.
- **`computeDotCount`** in `dataGenerator.js`: exported but no longer called by the UI (the manual drawer uses a fixed user-configured `dotCount` for all strokes).
