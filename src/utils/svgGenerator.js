export function generateFillSvg(pathD, width, height) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g><path id="fill" d="${pathD}" style="fill-rule:nonzero;"/></g></g>
</svg>`;
}

export function generateOutlineSvg(pathD, width, height, strokeWidth = 3) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g><path id="contorno" d="${pathD}" style="fill:none;stroke:#000;stroke-width:${strokeWidth}px;stroke-linecap:round;stroke-linejoin:round;"/></g></g>
</svg>`;
}

/**
 * Fallback fill SVG generated from the user's hand-drawn strokes.
 * Renders each stroke as a thick stroked path so the overall silhouette
 * resembles a filled letter. Used when no reference font is loaded.
 */
export function generateFillSvgFromStrokes(strokePaths, width, height, strokeWidth = 40) {
  const pathElements = strokePaths.map((p, i) =>
    `<path id="fill${i + 1}" d="${p.d}" style="fill:none;stroke:#000;stroke-width:${strokeWidth}px;stroke-linecap:round;stroke-linejoin:round;"/>`
  ).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g>
    ${pathElements}
  </g></g>
</svg>`;
}

/**
 * Outline SVG generated from the user's drawn strokes. Renders the letter as
 * a **hollow** body: the same stroke-based silhouette used by
 * `generateFillSvgFromStrokes`, but painted as a black rim of `borderWidth`
 * around a white interior.
 *
 * Implementation: two stacked layers of stroked paths over the same `d`:
 *   1. All strokes with `strokeWidth` in black  → outer rim (letter silhouette).
 *   2. All strokes with `strokeWidth - 2·borderWidth` in white → interior fill.
 *
 * Layering is all-black-first-then-all-white so that where two user strokes
 * overlap (e.g. bowl + tail of a cursive 'a') the white interior of one
 * stroke covers the black rim of the other — without this, the overlap would
 * show an internal seam.
 *
 * Matches the reference bundle's `letter-outline.svg` in spirit: a visible
 * letter contour with a blank interior (the dashed tracing guide and the
 * animated drawing stay readable through it).
 *
 * @param {Array<{d: string}>} strokePaths  one entry per user stroke
 * @param {number} width
 * @param {number} height
 * @param {number} strokeWidth   letter-body width in px (same value passed to
 *                               generateFillSvgFromStrokes — the outline is
 *                               meant to match the fill silhouette exactly)
 * @param {number} borderWidth   thickness of the visible black rim on each side
 */
export function generateOutlineSvgFromStrokes(strokePaths, width, height, strokeWidth = 40, borderWidth = 3) {
  const innerWidth = Math.max(1, strokeWidth - 2 * borderWidth);

  const outer = strokePaths.map((p, i) =>
    `<path id="contorno${i + 1}" d="${p.d}" style="fill:none;stroke:#000;stroke-width:${strokeWidth}px;stroke-linecap:round;stroke-linejoin:round;"/>`
  ).join('\n      ');

  const inner = strokePaths.map(p =>
    `<path d="${p.d}" style="fill:none;stroke:#fff;stroke-width:${innerWidth}px;stroke-linecap:round;stroke-linejoin:round;"/>`
  ).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g>
      ${outer}
      ${inner}
  </g></g>
</svg>`;
}

/**
 * Dotted SVG: renders each stroke as a dashed path (actual dashes, not round
 * dots), matching the visual of the historical lecto_pruebas_2026 bundles.
 *
 * The reference bundle ejemplo/trazado-letra-a/letter-dotted.svg uses capsule
 * shapes of roughly 12×5 px oriented along each stroke with a period of 18
 * px. We reproduce that with `stroke-dasharray` + rounded linecaps:
 *
 *   dasharray 7,11  →  visible dash 12  +  visible gap 6  (period 18)
 *   stroke-width 5  →  thickness 5 px matching the capsule height
 *
 * Shape of the output:
 *   <g><g><g id="path">
 *     <path id="path1" d="..." style="fill:none;stroke:#ccc;...stroke-dasharray:7,11;"/>
 *     <path id="path2" .../>
 *   </g></g></g>
 *
 * Selectors in `data.json.letterAnimationPath` (`#path1`, `#path2`, …) target
 * the individual <path> elements (not the wrapper `<g id="path">`).
 *
 * @param {Array<{ id?: string, d: string }>} strokePaths  one entry per stroke
 * @param {number} width
 * @param {number} height
 * @param {number} strokeWidth  dash thickness in px (default 5)
 * @param {string} dashArray    SVG dasharray string (default "7,11" → 12+6 visible with round caps)
 */
export function generateDottedSvg(
  strokePaths,
  width,
  height,
  strokeWidth = 5,
  dashArray = '7,11',
) {
  const paths = (strokePaths || []).map((p, i) =>
    `<path id="path${i + 1}" d="${p.d}" style="fill:none;stroke:#ccc;stroke-width:${strokeWidth}px;stroke-linecap:round;stroke-dasharray:${dashArray};"/>`
  ).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g><g id="path">
      ${paths}
  </g></g></g>
</svg>`;
}

/**
 * `base.svg` — a template SVG that mirrors the structure of the
 * `LetterX` React components in `ejemplo/letters.js`. The downstream
 * reader fetches this file as text and injects it via
 * `dangerouslySetInnerHTML` into a `<div style={{height:340}}>`, then
 * animates the `#path1`, `#path2`, … elements using
 * `stroke-dasharray` + `stroke-dashoffset`, uses the starting `#circle`
 * as the draggable marker, and `#letterBg` as the clickable background.
 *
 * Structure produced (for a two-stroke letter):
 *   <svg class="svg-letter" width="100%" height="100%" viewBox="0 0 W H">
 *     <rect id="letterBg" x="0" y="0" width="W" height="H"/>
 *     <path id="path1" class="svgPath" stroke-width="S" fill="none" d="M..."/>
 *     <path id="path2" class="svgPath" stroke-width="S" fill="none" d="M..."/>
 *     <circle id="circle" cx="X1" cy="Y1" r="R"/>
 *   </svg>
 *
 * Notes:
 *   • **No XML prolog / DOCTYPE / xmlns** — the reader injects this via
 *     innerHTML. An XML declaration or external DOCTYPE inside a `<div>`
 *     is invalid HTML: the parser turns the prolog into a bogus comment
 *     and subsequent attributes / CSS class lookups can break, leaving
 *     paths with their default `fill:black` (the "todo negro" bug).
 *     We output the same bare `<svg>` that React renders from the
 *     letters.js JSX.
 *   • Attribute names are the static-SVG form (`class`, `stroke-width`) —
 *     not the JSX `className` / `strokeWidth` used in letters.js.
 *   • `stroke-width` is baked in as `animationPathStroke` from data.json
 *     (= `effStroke` in GeneratorPage). In the JSX source it's a dynamic
 *     prop; here it must be a concrete number so the file stands alone.
 *   • `fill="none"` is emitted as a presentation-attribute fallback.
 *     The reader's CSS (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`)
 *     overrides both stroke colour and fill during animation; the inline
 *     `fill="none"` just protects against the brief render window before
 *     that CSS applies — without it, the path fills black by default.
 *   • Circle radius matches the JSX formula `Math.ceil(stroke / 1.4)`.
 *   • `cx`/`cy` are the start of the first stroke, matching how the
 *     JSX components place the marker at the starting dot of the letter.
 *
 * @param {Array<{d: string, points?: Array<{x:number,y:number}>}>} strokePaths
 * @param {number} width     canvas width (matches data.json.letterSize[0])
 * @param {number} height    canvas height (matches data.json.letterSize[1])
 * @param {number} stroke    concrete stroke-width (use animationPathStroke)
 */
export function generateBaseSvg(strokePaths, width, height, stroke) {
  const strokeW = Math.max(1, Math.round(stroke));
  const circleR = Math.ceil(strokeW / 1.4);

  // Inline `stroke="#f04e23"` + `fill="none"` as presentation-attribute
  // fallbacks. The reader's CSS (`.svg-letter .svgPath { fill:none; stroke:#f04e23 }`)
  // wins once it's loaded, but without the inline attrs the path renders
  // black-filled during the brief window before CSS applies, or entirely
  // when CSS fails to load.
  const pathElements = (strokePaths || []).map((p, i) =>
    `<path id="path${i + 1}" class="svgPath" stroke="#f04e23" fill="none" stroke-width="${strokeW}" d="${p.d}"/>`
  ).join('\n  ');

  // Marker circle at the first point of the first stroke — same spot where
  // the JSX components place `<circle id="circle" cx cy />`. `fill="blue"`
  // matches the reference `base.svg` shipped with the reader catalogue; the
  // reader may override via CSS, but the inline attribute guarantees a
  // visible marker if styles haven't kicked in yet.
  const first = strokePaths?.[0]?.points?.[0];
  const cx = first ? Math.round(first.x) : 0;
  const cy = first ? Math.round(first.y) : 0;

  return `<svg class="svg-letter" width="100%" height="100%" viewBox="0 0 ${width} ${height}">
  <rect id="letterBg" x="0" y="0" width="${width}" height="${height}"/>
  ${pathElements}
  <circle id="circle" cx="${cx}" cy="${cy}" r="${circleR}" fill="blue"/>
</svg>`;
}
