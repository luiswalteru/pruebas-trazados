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
 * Dotted SVG: renders a circle at each sampled coordinate of the trazado,
 * grouped per stroke with selector-compatible ids (#path1, #path2, …).
 */
export function generateDottedSvg(dotList, width, height, dotRadius = 6) {
  const groups = dotList.map((dl, i) => {
    const circles = (dl.coordinates || []).map(c => {
      const [x, y] = c.coords || [];
      return `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#888"/>`;
    }).join('');
    return `<g id="path${i + 1}">${circles}</g>`;
  }).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:1.41421;">
  <g><g>
      ${groups}
  </g></g>
</svg>`;
}
