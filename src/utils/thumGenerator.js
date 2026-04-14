/**
 * Generate thum.png by compositing letter-fill.svg (black letter body)
 * and letter-dotted.svg (dashed centerline) onto a canvas, matching the
 * visual of the reference bundle: dark filled letter with light dashes on top.
 */
export async function generateThumPngBlob({ fillSvg, dottedSvg, width, height }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  // Layer 1: letter fill (the solid letter shape)
  if (fillSvg) {
    const img = await loadSvgAsImage(fillSvg);
    ctx.drawImage(img, 0, 0, width, height);
  }

  // Layer 2: dotted / dashed centerline on top
  if (dottedSvg) {
    const img = await loadSvgAsImage(dottedSvg);
    ctx.drawImage(img, 0, 0, width, height);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function loadSvgAsImage(svgString) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
