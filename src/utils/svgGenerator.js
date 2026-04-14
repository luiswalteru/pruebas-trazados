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
 * Fallback outline SVG generated from strokes. Renders strokes as thin
 * stroked paths to emulate a letter contour when no reference font is loaded.
 */
export function generateOutlineSvgFromStrokes(strokePaths, width, height, borderWidth = 3) {
  const pathElements = strokePaths.map((p, i) =>
    `<path id="contorno${i + 1}" d="${p.d}" style="fill:none;stroke:#000;stroke-width:${borderWidth}px;stroke-linecap:round;stroke-linejoin:round;"/>`
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
