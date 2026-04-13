/**
 * Rasterize the filled letter plus the trazado dots into a PNG blob for thum.png.
 *
 * The thumbnail combines the letter fill with a circle at every sampled
 * coordinate so the user can see the full traced path on top of the shape.
 */
export async function generateThumPngBlob({
  fillPathD = '',
  strokePaths = [],
  dotList = [],
  width,
  height,
  dotRadius = 6,
  fallbackStrokeWidth = 40,
}) {
  // Fill layer: either the reference font glyph or the user's strokes thickened
  let fillMarkup;
  if (fillPathD) {
    fillMarkup = `<path d="${fillPathD}" fill="#000" fill-rule="nonzero"/>`;
  } else if (strokePaths.length > 0) {
    fillMarkup = strokePaths.map(p =>
      `<path d="${p.d}" fill="none" stroke="#000" stroke-width="${fallbackStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    ).join('');
  } else {
    fillMarkup = '';
  }

  // Dots layer on top
  const dotsMarkup = dotList.map(dl =>
    (dl.coordinates || []).map(c => {
      const [x, y] = c.coords || [];
      return `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#e91e63"/>`;
    }).join('')
  ).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${fillMarkup}${dotsMarkup}</svg>`;

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return pngBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
