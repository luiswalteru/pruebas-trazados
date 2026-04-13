import opentype from 'opentype.js';

export function parseFont(arrayBuffer) {
  const font = opentype.parse(arrayBuffer);
  return font;
}

export function getGlyphPath(font, char, fontSize = 300) {
  const glyph = font.charToGlyph(char);
  const path = glyph.getPath(0, 0, fontSize);
  // Get bounding box
  const bbox = path.getBoundingBox();
  return { path, bbox, glyph };
}

/**
 * Compute the "natural" canvas dimensions for a glyph so that it fills the
 * available height while keeping its aspect ratio.
 *
 * Reference values from the existing project:
 *   - Ligada  height ≈ 340  (except f=380)
 *   - Mayúsculas height ≈ 315  (except ñ=367)
 *   - Width varies per letter (95–600)
 *
 * @param {object} font     opentype.js Font object
 * @param {string} char     character (or combo first char) to measure
 * @param {string} type     'ligada' | 'mayusculas'
 * @param {number} padding  internal padding in px
 * @returns {{ width: number, height: number }}
 */
export function computeGlyphCanvasSize(font, char, type = 'ligada', padding = 20) {
  const baseHeight = type === 'mayusculas' ? 315 : 340;
  const fontSize = 300;
  const glyph = font.charToGlyph(char);
  const path = glyph.getPath(0, 0, fontSize);
  const bbox = path.getBoundingBox();

  const glyphW = bbox.x2 - bbox.x1;
  const glyphH = bbox.y2 - bbox.y1;
  if (glyphW === 0 || glyphH === 0) return { width: 200, height: baseHeight };

  // Scale so the glyph fills the base height (minus padding)
  const availH = baseHeight - padding * 2;
  const scale = availH / glyphH;
  const scaledW = glyphW * scale;

  // Width = scaled glyph width + padding on both sides, rounded to nearest int
  const width = Math.round(scaledW + padding * 2);

  return { width: Math.max(width, 80), height: baseHeight };
}

export function glyphToSvgPathData(font, char, targetWidth = 300, targetHeight = 300, padding = 20) {
  const fontSize = 300;
  const glyph = font.charToGlyph(char);
  const path = glyph.getPath(0, 0, fontSize);
  const bbox = path.getBoundingBox();

  const glyphW = bbox.x2 - bbox.x1;
  const glyphH = bbox.y2 - bbox.y1;

  const availW = targetWidth - padding * 2;
  const availH = targetHeight - padding * 2;
  const scale = Math.min(availW / glyphW, availH / glyphH);

  const offsetX = padding + (availW - glyphW * scale) / 2 - bbox.x1 * scale;
  const offsetY = padding + (availH - glyphH * scale) / 2 - bbox.y1 * scale;

  // Convert path commands to SVG d string with transform applied
  const commands = path.commands;
  let d = '';
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        d += `M${(cmd.x * scale + offsetX).toFixed(3)},${(cmd.y * scale + offsetY).toFixed(3)}`;
        break;
      case 'L':
        d += `L${(cmd.x * scale + offsetX).toFixed(3)},${(cmd.y * scale + offsetY).toFixed(3)}`;
        break;
      case 'Q':
        d += `Q${(cmd.x1 * scale + offsetX).toFixed(3)},${(cmd.y1 * scale + offsetY).toFixed(3)},${(cmd.x * scale + offsetX).toFixed(3)},${(cmd.y * scale + offsetY).toFixed(3)}`;
        break;
      case 'C':
        d += `C${(cmd.x1 * scale + offsetX).toFixed(3)},${(cmd.y1 * scale + offsetY).toFixed(3)},${(cmd.x2 * scale + offsetX).toFixed(3)},${(cmd.y2 * scale + offsetY).toFixed(3)},${(cmd.x * scale + offsetX).toFixed(3)},${(cmd.y * scale + offsetY).toFixed(3)}`;
        break;
      case 'Z':
        d += 'Z';
        break;
    }
  }

  return {
    d,
    width: targetWidth,
    height: targetHeight,
    scale,
    offsetX,
    offsetY,
    bbox: {
      x: bbox.x1 * scale + offsetX,
      y: bbox.y1 * scale + offsetY,
      w: glyphW * scale,
      h: glyphH * scale
    }
  };
}

export function getAvailableChars(font) {
  const chars = [];
  const glyphs = font.glyphs;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs.get(i);
    if (glyph.unicode && glyph.unicode >= 32) {
      chars.push(String.fromCharCode(glyph.unicode));
    }
  }
  return chars;
}
