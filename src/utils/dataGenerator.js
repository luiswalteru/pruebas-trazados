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

  // Shape matches `ejemplo/trazado-letra-a/data.json` — the canonical reference
  // the reader reads. This tool only emits `data.json` + `base.svg`; the
  // `character` / `letterFill` / `letterOutline` / `letterDotted` pointers
  // stay in the JSON because the reader still loads those files, which are
  // authored by the content pipeline and shipped alongside this generator's
  // output. Keep the field order identical to the reference so diffs are
  // readable against the existing trazados catalogue.
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
 * Compute recommended dotSize and animationPathStroke for a letter.
 *
 * `animationPathStroke` is fixed at 16 — matches the canonical reference
 * `ejemplo/trazado-letra-a/data.json` and its paired `base.svg`, which render
 * the trazado with `stroke-width="16"`. All generated `base.svg` files must
 * emit the same value so the visual weight of the animated stroke is
 * consistent with the reference across letters. The user can still override
 * via the `strokeWidth` input in Step 2 (`0 = use this default`).
 *
 * `dotSize` still varies by canvas width and per-letter overrides to match
 * the tuning in the existing `lecto_pruebas_2026` bundles.
 *
 * @param {string} letter   e.g. 'a', 'ch'
 * @param {string} type     'ligada' | 'mayusculas'
 * @param {number} canvasW  computed canvas width for this letter
 * @returns {{ dotSize: number, animationPathStroke: number }}
 */
export function computeLetterParams(letter, type, canvasW) {
  const animationPathStroke = 16;

  if (type === 'mayusculas') {
    return {
      dotSize: canvasW > 240 ? 40 : 34,
      animationPathStroke,
    };
  }

  // Ligada: dotSize varies by canvas width as a proxy for letter complexity
  let dotSize;
  if (canvasW <= 200) {
    dotSize = 28;           // narrow: f, l, t, j
  } else if (canvasW <= 300) {
    dotSize = 28;           // medium-narrow: b, d, g, h, y, q
  } else if (canvasW <= 400) {
    dotSize = 33;           // normal: a, c, e, o, r, s, z
  } else if (canvasW <= 500) {
    dotSize = 36;           // wide: ch, n, v, x
  } else {
    dotSize = 38;           // very wide: m, w
  }

  // Per-letter dotSize overrides matching existing data
  const dotSizeOverrides = {
    e: 40, i: 40, k: 38, m: 38, n: 40, u: 40, p: 27,
  };
  if (dotSizeOverrides[letter] != null) {
    dotSize = dotSizeOverrides[letter];
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
