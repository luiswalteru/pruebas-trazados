export function generateDataJson({
  letter,
  type, // 'ligada' or 'mayusculas'
  letterSize,
  dotList,
  animationPaths,
  animationPathStroke = 16,
  dotSize = 33,
}) {
  const isUpper = type === 'mayusculas';
  const displayLetter = isUpper ? letter.toUpperCase() : letter.toLowerCase();

  // Build the letter field: Upper prefix for mayusculas, first letter capitalized for combos
  let letterField;
  if (isUpper) {
    const base = letter.length > 1
      ? letter.charAt(0).toUpperCase() + letter.slice(1).toLowerCase()
      : letter.toUpperCase();
    letterField = `Upper${base}`;
  } else {
    letterField = letter.toLowerCase();
  }

  const titleEs = `Trazado de la letra «${displayLetter}».`;
  const titleVal = `Trazado de la letra «${displayLetter}».`;

  const data = {
    activityId: 'trazados',
    sectionId: 'trazados',
    title: {
      es: titleEs,
      val: titleVal,
      audio: {
        es: 'audio/es/title',
        val: 'audio/val/title'
      }
    },
    character: 'character.png',
    letterFill: 'letter-fill.svg',
    letterOutline: 'letter-outline.svg',
    letterDotted: 'letter-dotted.svg',
    letter: letterField,
    letterSize: letterSize,
    animationPathStroke: animationPathStroke,
    letterAnimationPath: animationPaths.map((p, i) => ({
      selector: `#path${i + 1}`,
      time: p.time || Math.max(2, Math.round(p.length / 50))
    })),
    dotSize: dotSize,
    playButtonPosition: [-20, 30],
    dotList: dotList
  };

  return data;
}

export function getFolderName(letter, type) {
  const specialMap = {
    'ñ': 'ny',
    'ch': 'ch',
    'll': 'll',
  };

  const base = specialMap[letter.toLowerCase()] || letter.toLowerCase();

  if (type === 'mayusculas') {
    return `trazado-letra-${base}-mayus`;
  }
  return `trazado-letra-${base}`;
}

export const SPANISH_LETTERS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
  'm', 'n', 'ñ', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w',
  'x', 'y', 'z'
];

export const SPECIAL_COMBOS = ['ch', 'll'];

/**
 * Compute recommended dotSize and animationPathStroke for a letter based on
 * the patterns found in the existing lecto_pruebas_2026 trazados.
 *
 * Ligada:
 *   - dotSize: 26–40  (smaller for narrow letters like b,d,j,l; bigger for wide/simple like e,n,u)
 *   - animationPathStroke: 10–18  (12 for narrow, 16 for normal, 18 for simple)
 *
 * Mayúsculas:
 *   - dotSize: mostly 34  (range 33–40)
 *   - animationPathStroke: mostly 10  (range 10–12)
 *
 * @param {string} letter   e.g. 'a', 'ch'
 * @param {string} type     'ligada' | 'mayusculas'
 * @param {number} canvasW  computed canvas width for this letter
 * @returns {{ dotSize: number, animationPathStroke: number }}
 */
export function computeLetterParams(letter, type, canvasW) {
  if (type === 'mayusculas') {
    // Mayúsculas: very consistent values
    const isWide = canvasW > 350;  // CH, LL
    return {
      dotSize: canvasW > 240 ? 40 : 34,
      animationPathStroke: isWide ? 12 : 10,
    };
  }

  // Ligada: varies more — use canvas width as a proxy for letter complexity
  let dotSize, animationPathStroke;

  if (canvasW <= 200) {
    // Narrow letters like f, l, t, j
    dotSize = 28;
    animationPathStroke = 10;
  } else if (canvasW <= 300) {
    // Medium-narrow: b, d, g, h, y, q
    dotSize = 28;
    animationPathStroke = 12;
  } else if (canvasW <= 400) {
    // Normal width: a, c, e, o, r, s, z, etc.
    dotSize = 33;
    animationPathStroke = 16;
  } else if (canvasW <= 500) {
    // Wide: ch, n, v, x
    dotSize = 36;
    animationPathStroke = 16;
  } else {
    // Very wide: m, w
    dotSize = 38;
    animationPathStroke = 16;
  }

  // Special overrides matching existing data
  const overrides = {
    'e': { dotSize: 40, animationPathStroke: 16 },
    'i': { dotSize: 40, animationPathStroke: 18 },
    'k': { dotSize: 38, animationPathStroke: 12 },
    'm': { dotSize: 38, animationPathStroke: 16 },
    'n': { dotSize: 40, animationPathStroke: 16 },
    'u': { dotSize: 40, animationPathStroke: 16 },
    'p': { dotSize: 27, animationPathStroke: 10 },
  };

  if (overrides[letter]) {
    return overrides[letter];
  }

  return { dotSize, animationPathStroke };
}

/**
 * Compute recommended number of coordinate points for a single stroke
 * based on the stroke's path length in pixels.
 *
 * From the existing data:
 *   - Short strokes (dots on i/j, bar on t):  2–7 coords
 *   - Medium strokes (curves):               14–33 coords
 *   - Long strokes (full cursive letters):   40–84 coords
 *
 * Rough ratio from existing data: ~1 coord per 5–8 pixels of path length.
 *
 * @param {number} pathLengthPx  approximate length of the stroke in pixels
 * @returns {number}  recommended number of coordinate points
 */
export function computeDotCount(pathLengthPx) {
  // ~1 point per 6.5 px of path, clamped to [3, 90]
  const count = Math.round(pathLengthPx / 6.5);
  return Math.max(3, Math.min(90, count));
}
