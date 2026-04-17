/**
 * Rasterize a letter's fill SVG into a binary mask and precompute a distance
 * transform so drawn points can be pulled toward the letter's medial axis
 * (skeleton) in a stable, direction-independent way.
 */
export async function buildLetterMask(fillSvgContent, width, height) {
  if (!fillSvgContent || !width || !height) return null;

  const blob = new Blob([fillSvgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return buildMaskFromDrawnImage(img, width, height, (a) => a > 32);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Build a binary mask + distance transform from a raster image (PNG/JPG data
 * URL or object URL). A pixel counts as "inside the letter" when it is both
 * sufficiently opaque AND darker than the paper — this handles transparent
 * PNGs (letter on transparent bg) and flat JPGs (dark letter on white) with
 * the same rule.
 */
export async function buildMaskFromImage(imageSrc, width, height) {
  if (!imageSrc || !width || !height) return null;
  const img = await loadImage(imageSrc);
  // inside = opaque AND dark: alpha > 128 AND luminance < 200
  const isInside = (r, g, b, a) => {
    if (a <= 128) return false;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 200;
  };
  return buildMaskFromDrawnImage(img, width, height, null, isInside);
}

function buildMaskFromDrawnImage(img, width, height, alphaPredicate, rgbaPredicate) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = imgData.data[i * 4];
    const g = imgData.data[i * 4 + 1];
    const b = imgData.data[i * 4 + 2];
    const a = imgData.data[i * 4 + 3];
    const inside = rgbaPredicate ? rgbaPredicate(r, g, b, a) : alphaPredicate(a);
    mask[i] = inside ? 1 : 0;
  }
  const dist = computeDistanceTransform(mask, width, height);
  return { mask, dist, width, height };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function isInside(maskInfo, x, y) {
  const { mask, width, height } = maskInfo;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= width || iy < 0 || iy >= height) return false;
  return mask[iy * width + ix] === 1;
}

/**
 * Chamfer distance transform (3-4 approximation, scaled so that orthogonal
 * step ≈ 1 px). Outside pixels get distance 0; inside pixels get the distance
 * in pixels to the nearest outside pixel.
 */
function computeDistanceTransform(mask, width, height) {
  const N = width * height;
  const dist = new Float32Array(N);
  const INF = 1e9;
  for (let i = 0; i < N; i++) dist[i] = mask[i] === 1 ? INF : 0;

  const D1 = 1;
  const D2 = Math.SQRT2;

  // Forward pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0)                  d = Math.min(d, dist[i - 1] + D1);
      if (y > 0)                  d = Math.min(d, dist[i - width] + D1);
      if (x > 0 && y > 0)         d = Math.min(d, dist[i - width - 1] + D2);
      if (x < width - 1 && y > 0) d = Math.min(d, dist[i - width + 1] + D2);
      dist[i] = d;
    }
  }
  // Backward pass
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x < width - 1)                   d = Math.min(d, dist[i + 1] + D1);
      if (y < height - 1)                  d = Math.min(d, dist[i + width] + D1);
      if (x < width - 1 && y < height - 1) d = Math.min(d, dist[i + width + 1] + D2);
      if (x > 0 && y < height - 1)         d = Math.min(d, dist[i + width - 1] + D2);
      dist[i] = d;
    }
  }
  return dist;
}

function sampleDist(maskInfo, x, y) {
  const { dist, width, height } = maskInfo;
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return dist[iy * width + ix];
}

/** Spiral search for the nearest pixel inside the letter. */
function findNearestInside(maskInfo, x, y, maxRadius) {
  if (isInside(maskInfo, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (isInside(maskInfo, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/**
 * Post-process centering pass for a finished stroke.
 *
 * Intended to run AFTER the user has drawn the full stroke (or all strokes of
 * a letter) to remove hand-tremor wobble and pull the trajectory onto the
 * letter's medial axis. The pipeline is:
 *
 *   1. Heavy Gaussian-like smoothing (25/50/25 neighbours, N iterations) to
 *      erase high-frequency tremor. Endpoints are preserved.
 *   2. Iterative aggressive snapToCenterline — same radial pull as the
 *      realtime drawer, but with a bigger maxStep and repeated several times
 *      so the whole stroke relaxes onto the skeleton.
 *   3. Light smoothing to recover C1 continuity after the discrete snaps.
 *
 * If `maskInfo` is null (no reference font loaded) the function still does
 * pre/post smoothing but skips the snap step. That lets the button work as a
 * "heavy smooth" even without a mask.
 *
 * @param {Array<{x,y}>} points
 * @param {Object|null}  maskInfo       result of buildLetterMask, or null
 * @param {Object}       opts
 */
export function centerStrokePoints(points, maskInfo, opts = {}) {
  if (!points || points.length < 3) return points || [];

  const preSmoothIterations  = opts.preSmoothIterations  ?? 8;
  const snapIterations       = opts.snapIterations       ?? 12;
  const snapPullStrength     = opts.snapPullStrength     ?? 2.5;
  const snapMaxStep          = opts.snapMaxStep          ?? 5;
  const snapPullRadius       = opts.snapPullRadius       ?? 60;
  const postSmoothIterations = opts.postSmoothIterations ?? 2;

  let pts = smoothPoints(points, preSmoothIterations);

  if (maskInfo) {
    const snapOpts = {
      pullStrength: snapPullStrength,
      maxStep: snapMaxStep,
      pullRadius: snapPullRadius,
    };
    for (let i = 0; i < snapIterations; i++) {
      pts = pts.map(p => snapToCenterline(p, maskInfo, snapOpts));
    }
  }

  return smoothPoints(pts, postSmoothIterations);
}

function smoothPoints(points, iterations) {
  if (iterations <= 0 || points.length < 3) return points.map(p => ({ x: p.x, y: p.y }));
  let pts = points.map(p => ({ x: p.x, y: p.y }));
  for (let iter = 0; iter < iterations; iter++) {
    const next = [pts[0]];
    for (let j = 1; j < pts.length - 1; j++) {
      next.push({
        x: pts[j - 1].x * 0.25 + pts[j].x * 0.5 + pts[j + 1].x * 0.25,
        y: pts[j - 1].y * 0.25 + pts[j].y * 0.5 + pts[j + 1].y * 0.25,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/**
 * Pull a point gently toward the letter's medial axis (skeleton).
 *
 * Uses the gradient of the distance transform: inside a shape, the gradient
 * of the Euclidean distance-to-boundary field points away from the nearest
 * edge — i.e., toward the skeleton. At the skeleton the gradient magnitude
 * drops to ~0, so the correction naturally fades to zero when the point is
 * already centered. This avoids sign flips and jumps caused by using the
 * user's travel direction.
 *
 * @param {Object} point              { x, y } — the point to center (already input-smoothed)
 * @param {Object} maskInfo           result of buildLetterMask, or null for no-op
 * @param {number} opts.pullStrength  multiplier for the per-sample pull (default 1.2)
 * @param {number} opts.maxStep       clamp on per-sample movement in px (default 2)
 * @param {number} opts.pullRadius    max radius to pull an outside point inside
 */
export function snapToCenterline(point, maskInfo, opts = {}) {
  if (!maskInfo) return { x: point.x, y: point.y };
  const pullStrength = opts.pullStrength ?? 1.2;
  const maxStep = opts.maxStep ?? 2;
  const pullRadius = opts.pullRadius ?? 40;

  let x = point.x;
  let y = point.y;

  if (!isInside(maskInfo, x, y)) {
    const near = findNearestInside(maskInfo, x, y, pullRadius);
    if (!near) return { x: point.x, y: point.y };
    x = near.x;
    y = near.y;
  }

  const { width, height } = maskInfo;
  // Finite-difference gradient of the distance field
  const h = 2;
  const dxR = sampleDist(maskInfo, Math.min(width - 1, x + h), y);
  const dxL = sampleDist(maskInfo, Math.max(0, x - h), y);
  const dyD = sampleDist(maskInfo, x, Math.min(height - 1, y + h));
  const dyU = sampleDist(maskInfo, x, Math.max(0, y - h));
  const gx = (dxR - dxL) / (2 * h);
  const gy = (dyD - dyU) / (2 * h);
  const gmag = Math.hypot(gx, gy);

  // Near the skeleton the gradient is ~0 — the point is already centered
  if (gmag < 0.15) return { x, y };

  // Step size proportional to gradient magnitude, clamped to maxStep
  const step = Math.min(maxStep, gmag * pullStrength);
  return {
    x: x + (gx / gmag) * step,
    y: y + (gy / gmag) * step,
  };
}
