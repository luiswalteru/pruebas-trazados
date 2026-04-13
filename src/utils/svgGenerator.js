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
 * Dotted SVG: renders each stroke as a dashed path along the stroke's "d"
 * string, producing the dotted-line appearance the downstream player expects.
 *
 * Shape of the output (matches the historical lecto_pruebas_2026 format):
 *   <g><g><g id="path">
 *     <path id="path1" d="..." style="fill:none;stroke:#ccc;...stroke-dasharray:0.1,16;"/>
 *     <path id="path2" .../>
 *   </g></g></g>
 *
 * The selectors `#path1`, `#path2`, … in data.json.letterAnimationPath target
 * the individual <path> elements (not the wrapper <g id="path">).
 *
 * @param {Array<{ id?: string, d: string }>} strokePaths  one entry per stroke
 * @param {number} width
 * @param {number} height
 * @param {number} strokeWidth  stroke thickness in px (default 8, the historical value)
 */
export function generateDottedSvg(strokePaths, width, height, strokeWidth = 8) {
  const paths = (strokePaths || []).map((p, i) =>
    `<path id="path${i + 1}" d="${p.d}" style="fill:none;stroke:#ccc;stroke-width:${strokeWidth}px;stroke-linecap:round;stroke-dasharray:0.1,16;"/>`
  ).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g><g id="path">
      ${paths}
  </g></g></g>
</svg>`;
}
