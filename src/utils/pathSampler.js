// =============================================================================
// pathSampler.js — Centerline extraction & dot coordinate generation
//
// Uses Zhang-Suen thinning to find the skeleton (centerline) of a filled glyph,
// then splits the skeleton at junction points into individual stroke segments,
// orients each segment following natural handwriting direction (top→bottom,
// left→right), and returns ordered multi-stroke dot lists.
//
// v2 – Improvements:
//   • Rasterize at higher resolution (RASTER_SCALE×) for cleaner skeletons
//   • Smooth skeleton points BEFORE resampling to eliminate pixel-zigzag
//   • Filter out very short segments (noise) relative to longest segment
//   • Merge nearly-collinear segments that were over-split at junctions
// =============================================================================

// How much bigger the rasterization canvas is vs the letter-space coordinates.
// Higher = smoother skeleton but slower. 2× is a good tradeoff.
const RASTER_SCALE = 2;

// Minimum segment length as fraction of the longest segment to keep (filter noise)
const MIN_SEGMENT_RATIO = 0.08;

// ---------------------------------------------------------------------------
// PUBLIC: extract oriented skeleton segments from a glyph path.
// Returns { segments, lengths } where segments are smoothed point arrays
// and lengths are the pixel-path-length of each one.
// This is used by the generator to compute dynamic dotCount per stroke.
// ---------------------------------------------------------------------------
export function extractSkeletonSegments(pathD, width, height) {
  const skeleton = skeletonize(pathD, width, height);
  if (skeleton.points.length === 0) return { segments: [], lengths: [] };

  const raw = splitSkeletonAtJunctions(skeleton);
  const merged = mergeCollinearSegments(raw);
  const filtered = filterShortSegments(merged);
  const oriented = orientAndOrderSegments(filtered);

  const segments = [];
  const lengths = [];
  for (const seg of oriented) {
    if (seg.length < 3) continue;
    const smoothed = smoothPoints(seg, 4);
    let len = 0;
    for (let i = 1; i < smoothed.length; i++) {
      len += Math.hypot(smoothed[i].x - smoothed[i-1].x, smoothed[i].y - smoothed[i-1].y);
    }
    segments.push(smoothed);
    lengths.push(len);
  }

  return { segments, lengths };
}

// ---------------------------------------------------------------------------
// PUBLIC: returns an ARRAY of { dragger, coordinates } — one per stroke
//
// numPointsPerStroke can be:
//   - a single number → same count for every stroke
//   - an array of numbers → one count per stroke (matched by index)
// ---------------------------------------------------------------------------
export function samplePathPointsMultiStroke(pathD, numPointsPerStroke = 40, dotSize = 33, width = 380, height = 340) {
  const { segments } = extractSkeletonSegments(pathD, width, height);

  if (segments.length === 0) {
    return [{ dragger: [Math.round(width / 2), Math.round(height / 2)], coordinates: [] }];
  }

  const perStrokeCounts = Array.isArray(numPointsPerStroke) ? numPointsPerStroke : null;

  const result = [];
  for (let si = 0; si < segments.length; si++) {
    const smoothed = segments[si];
    const n = perStrokeCounts ? (perStrokeCounts[si] || perStrokeCounts[0] || 40) : numPointsPerStroke;
    const resampled = resamplePath(smoothed, n);
    const points = resampled.map(p => ({
      coords: [parseFloat(p.x.toFixed(3)), parseFloat(p.y.toFixed(3))]
    }));
    markCorners(points);
    const dragger = [
      parseFloat(resampled[0].x.toFixed(0)),
      parseFloat(resampled[0].y.toFixed(0))
    ];
    result.push({ dragger, coordinates: points });
  }

  return result.length > 0
    ? result
    : [{ dragger: [Math.round(width / 2), Math.round(height / 2)], coordinates: [] }];
}

// Backward-compatible single-stroke version (picks the longest stroke)
export function samplePathPoints(pathD, numPoints = 40, dotSize = 33, width = 380, height = 340) {
  const all = samplePathPointsMultiStroke(pathD, numPoints, dotSize, width, height);
  return all[0];
}

// ---------------------------------------------------------------------------
// PUBLIC: generate centerline SVG paths (for letter-dotted.svg)
// ---------------------------------------------------------------------------
export function generateCenterlinePaths(pathD, width, height) {
  const skeleton = skeletonize(pathD, width, height);
  if (skeleton.points.length === 0) return [{ id: 'path1', d: pathD }];

  const segments = splitSkeletonAtJunctions(skeleton);
  const merged = mergeCollinearSegments(segments);
  const filtered = filterShortSegments(merged);
  const oriented = orientAndOrderSegments(filtered);

  const paths = oriented
    .filter(s => s.length >= 4)
    .map((stroke, i) => {
      const smoothed = smoothPoints(stroke, 5);
      const d = pointsToSvgPath(smoothed);
      return { id: `path${i + 1}`, d };
    });

  return paths.length > 0 ? paths : [{ id: 'path1', d: pathD }];
}

// ---------------------------------------------------------------------------
// PUBLIC: extract SVG path "d" attributes from an SVG string
// ---------------------------------------------------------------------------
export function extractPathsFromSvg(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const paths = doc.querySelectorAll('path');
  const result = [];
  paths.forEach(p => {
    const d = p.getAttribute('d');
    const id = p.getAttribute('id') || '';
    if (d) result.push({ id, d });
  });
  const svgEl = doc.querySelector('svg');
  const viewBox = svgEl
    ? svgEl.getAttribute('viewBox') || svgEl.getAttribute('viewbox')
    : null;
  let width = 380, height = 340;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length >= 4) { width = parts[2]; height = parts[3]; }
  }
  return { paths: result, width, height };
}


// =============================================================================
// SKELETONIZATION — Zhang-Suen thinning at higher resolution
// =============================================================================

function skeletonize(pathD, width, height) {
  // Rasterize at higher resolution for better skeleton quality
  const rw = Math.round(width * RASTER_SCALE);
  const rh = Math.round(height * RASTER_SCALE);

  const canvas = document.createElement('canvas');
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext('2d');

  // Scale the path to the raster resolution
  ctx.save();
  ctx.scale(RASTER_SCALE, RASTER_SCALE);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(pathD));
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, rw, rh);
  const px = imageData.data;
  const grid = new Uint8Array(rw * rh);
  for (let i = 0; i < rw * rh; i++) {
    grid[i] = px[i * 4 + 3] > 128 ? 1 : 0;
  }

  zhangSuenThin(grid, rw, rh);

  // Collect skeleton points and scale back to letter-space
  const points = [];
  for (let y = 1; y < rh - 1; y++) {
    for (let x = 1; x < rw - 1; x++) {
      if (grid[y * rw + x] === 1) {
        points.push({ x: x / RASTER_SCALE, y: y / RASTER_SCALE });
      }
    }
  }

  return { points, grid, w: rw, h: rh, scale: RASTER_SCALE };
}

function zhangSuenThin(grid, w, h) {
  let changed = true;
  while (changed) {
    changed = false;
    const r1 = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!grid[y * w + x]) continue;
      const n = n8(grid, x, y, w);
      const B = sumN(n);
      if (B < 2 || B > 6) continue;
      if (tr01(n) !== 1) continue;
      if (n[0] * n[2] * n[4] === 0 && n[2] * n[4] * n[6] === 0)
        r1.push(y * w + x);
    }
    for (const i of r1) { grid[i] = 0; changed = true; }

    const r2 = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!grid[y * w + x]) continue;
      const n = n8(grid, x, y, w);
      const B = sumN(n);
      if (B < 2 || B > 6) continue;
      if (tr01(n) !== 1) continue;
      if (n[0] * n[2] * n[6] === 0 && n[0] * n[4] * n[6] === 0)
        r2.push(y * w + x);
    }
    for (const i of r2) { grid[i] = 0; changed = true; }
  }
}

//  7  0  1
//  6  X  2
//  5  4  3
function n8(grid, x, y, w) {
  return [
    grid[(y-1)*w+x], grid[(y-1)*w+x+1], grid[y*w+x+1], grid[(y+1)*w+x+1],
    grid[(y+1)*w+x], grid[(y+1)*w+x-1], grid[y*w+x-1], grid[(y-1)*w+x-1],
  ];
}
function sumN(n) { return n[0]+n[1]+n[2]+n[3]+n[4]+n[5]+n[6]+n[7]; }
function tr01(n) {
  let c = 0;
  for (let i = 0; i < 8; i++) if (n[i] === 0 && n[(i+1)%8] === 1) c++;
  return c;
}


// =============================================================================
// JUNCTION DETECTION & SEGMENT SPLITTING
//
// Works in raster-space (high-res grid), then segments are returned in
// letter-space coordinates (divided by RASTER_SCALE).
// =============================================================================

function splitSkeletonAtJunctions(skeleton) {
  const { points, grid, w, h, scale } = skeleton;
  if (points.length === 0) return [];

  // We need to work in raster-space for grid operations
  // Convert points back to raster coords for grid lookup
  const rasterPoints = points.map(p => ({
    x: Math.round(p.x * scale),
    y: Math.round(p.y * scale),
    lx: p.x,  // keep letter-space coords
    ly: p.y,
  }));

  // Classify pixels
  const ENDPOINT = 1, NORMAL = 2, JUNCTION = 3;
  const kind = new Uint8Array(w * h);
  const junctions = [];
  const endpoints = [];

  for (const p of rasterPoints) {
    const idx = p.y * w + p.x;
    if (idx < 0 || idx >= w * h || grid[idx] !== 1) continue;
    const nb = countNb(grid, p.x, p.y, w);
    if (nb <= 1) { kind[idx] = ENDPOINT; endpoints.push(p); }
    else if (nb >= 3) { kind[idx] = JUNCTION; junctions.push(p); }
    else { kind[idx] = NORMAL; }
  }

  // Make a working copy and remove junction pixels to split
  const work = new Uint8Array(grid);
  for (const j of junctions) work[j.y * w + j.x] = 0;

  // Trace each connected component in the junction-less grid
  const visited = new Uint8Array(w * h);
  const rawSegments = [];

  // Prefer starting from endpoints
  const startCandidates = [...endpoints];
  for (const p of rasterPoints) {
    if (kind[p.y * w + p.x] !== JUNCTION) startCandidates.push(p);
  }

  for (const sp of startCandidates) {
    const idx = sp.y * w + sp.x;
    if (visited[idx] || work[idx] === 0) continue;
    const seg = traceConnected(work, visited, sp.x, sp.y, w, h);
    if (seg.length >= 2) rawSegments.push(seg);
  }

  // Re-attach junction pixels to nearest segment ends
  for (const j of junctions) {
    for (const seg of rawSegments) {
      const first = seg[0];
      const last = seg[seg.length - 1];
      const dFirst = Math.abs(j.x - first.x) + Math.abs(j.y - first.y);
      const dLast  = Math.abs(j.x - last.x) + Math.abs(j.y - last.y);
      if (dFirst <= 3) seg.unshift({ x: j.x, y: j.y });
      else if (dLast <= 3) seg.push({ x: j.x, y: j.y });
    }
  }

  // Convert all segments back to letter-space
  return rawSegments.map(seg =>
    seg.map(p => ({ x: p.x / scale, y: p.y / scale }))
  );
}

function countNb(grid, x, y, w) {
  const n = n8(grid, x, y, w);
  return n[0]+n[1]+n[2]+n[3]+n[4]+n[5]+n[6]+n[7];
}

// Trace a connected chain of pixels using greedy neighbor-following
function traceConnected(grid, visited, sx, sy, w, h) {
  const path = [];
  let cx = sx, cy = sy;
  const dx8 = [0,1,1,1,0,-1,-1,-1];
  const dy8 = [-1,-1,0,1,1,1,0,-1];

  while (true) {
    const idx = cy * w + cx;
    if (visited[idx]) break;
    if (grid[idx] === 0) break;
    visited[idx] = 1;
    path.push({ x: cx, y: cy });

    // Pick unvisited neighbor, preferring direction continuity
    let bestX = -1, bestY = -1, bestScore = -Infinity;
    let dirX = 0, dirY = 0;
    if (path.length >= 2) {
      const prev = path[path.length - 2];
      dirX = cx - prev.x; dirY = cy - prev.y;
      const len = Math.hypot(dirX, dirY);
      if (len) { dirX /= len; dirY /= len; }
    }

    for (let i = 0; i < 8; i++) {
      const nx = cx + dx8[i], ny = cy + dy8[i];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (grid[ni] === 0 || visited[ni]) continue;
      const score = dirX * dx8[i] + dirY * dy8[i];
      if (score > bestScore) { bestScore = score; bestX = nx; bestY = ny; }
    }
    if (bestX < 0) break;
    cx = bestX; cy = bestY;
  }
  return path;
}


// =============================================================================
// MERGE NEARLY-COLLINEAR SEGMENTS
//
// When a junction splits a mostly-straight stroke into two pieces, merge them
// back if the angle at the junction is nearly straight (< 30°).
// =============================================================================

function mergeCollinearSegments(segments) {
  if (segments.length <= 1) return segments;

  const merged = [...segments.map(s => [...s])];
  let didMerge = true;

  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length && !didMerge; i++) {
      for (let j = i + 1; j < merged.length && !didMerge; j++) {
        const a = merged[i];
        const b = merged[j];
        if (a.length < 2 || b.length < 2) continue;

        // Check all 4 end-to-end combinations
        const combos = [
          { aEnd: 'last',  bEnd: 'first', dist: ptDist(a[a.length-1], b[0]) },
          { aEnd: 'last',  bEnd: 'last',  dist: ptDist(a[a.length-1], b[b.length-1]) },
          { aEnd: 'first', bEnd: 'first', dist: ptDist(a[0], b[0]) },
          { aEnd: 'first', bEnd: 'last',  dist: ptDist(a[0], b[b.length-1]) },
        ];

        for (const c of combos) {
          if (c.dist > 4) continue;  // ends must be very close (junction neighborhood)

          // Get direction vectors at the junction
          let dirA, dirB;
          if (c.aEnd === 'last') {
            const p = a[Math.max(0, a.length - 6)];
            dirA = { x: a[a.length-1].x - p.x, y: a[a.length-1].y - p.y };
          } else {
            const p = a[Math.min(a.length-1, 5)];
            dirA = { x: a[0].x - p.x, y: a[0].y - p.y };
          }
          if (c.bEnd === 'first') {
            const p = b[Math.min(b.length-1, 5)];
            dirB = { x: p.x - b[0].x, y: p.y - b[0].y };
          } else {
            const p = b[Math.max(0, b.length - 6)];
            dirB = { x: p.x - b[b.length-1].x, y: p.y - b[b.length-1].y };
          }

          const angle = angleBetween(dirA, dirB);
          if (angle > Math.PI / 6) continue;  // > 30° → not collinear enough

          // Merge: arrange so a flows into b
          let newSeg;
          if (c.aEnd === 'last' && c.bEnd === 'first') {
            newSeg = [...a, ...b];
          } else if (c.aEnd === 'last' && c.bEnd === 'last') {
            newSeg = [...a, ...[...b].reverse()];
          } else if (c.aEnd === 'first' && c.bEnd === 'first') {
            newSeg = [[...a].reverse(), ...b].flat();
          } else {
            newSeg = [[...a].reverse(), ...[...b].reverse()].flat();
          }

          merged[i] = newSeg;
          merged.splice(j, 1);
          didMerge = true;
          break;
        }
      }
    }
  }

  return merged;
}

function ptDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleBetween(a, b) {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  const dot = (a.x * b.x + a.y * b.y) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}


// =============================================================================
// FILTER SHORT SEGMENTS (noise / spurs)
// =============================================================================

function filterShortSegments(segments) {
  if (segments.length <= 1) return segments;

  // Calculate length of each segment
  const withLength = segments.map(seg => {
    let len = 0;
    for (let i = 1; i < seg.length; i++) {
      len += Math.hypot(seg[i].x - seg[i-1].x, seg[i].y - seg[i-1].y);
    }
    return { seg, len };
  });

  const maxLen = Math.max(...withLength.map(s => s.len));
  const threshold = maxLen * MIN_SEGMENT_RATIO;

  const filtered = withLength
    .filter(s => s.len >= threshold)
    .map(s => s.seg);

  return filtered.length > 0 ? filtered : [segments[0]];
}


// =============================================================================
// STROKE ORIENTATION & ORDERING
//
// For each segment decide which end is the "start":
//   • Vertical / diagonal strokes → topmost end first  (smaller y wins)
//   • Horizontal strokes (small Δy) → leftmost end first  (smaller x wins)
//
// Then sort all segments so the first stroke to trace is:
//   1. The one whose start is highest (smallest y).
//   2. Tie-break: leftmost (smallest x).
// =============================================================================

function orientAndOrderSegments(segments) {
  if (segments.length === 0) return [];

  const oriented = segments.map(seg => {
    const first = seg[0];
    const last  = seg[seg.length - 1];
    const dy = Math.abs(last.y - first.y);
    const dx = Math.abs(last.x - first.x);

    let needsFlip = false;

    if (dy > dx * 0.5) {
      // Mostly vertical / diagonal → start at the TOP (smaller y)
      needsFlip = last.y < first.y;
    } else {
      // Mostly horizontal → start at the LEFT (smaller x)
      needsFlip = last.x < first.x;
    }

    return needsFlip ? [...seg].reverse() : seg;
  });

  // Sort: topmost start first, then leftmost
  oriented.sort((a, b) => {
    const ay = a[0].y, by = b[0].y;
    if (Math.abs(ay - by) > 5) return ay - by;  // top first
    return a[0].x - b[0].x;                      // left first
  });

  return oriented;
}


// =============================================================================
// PATH UTILITIES — smoothing, resampling, SVG path conversion, corners
// =============================================================================

function resamplePath(points, numPoints) {
  if (points.length <= 1) return points;
  if (points.length <= numPoints) {
    // Still resample evenly even if we have fewer original points
    // to produce exactly numPoints output points
  }

  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(
      points[i].x - points[i-1].x,
      points[i].y - points[i-1].y
    ));
  }
  const total = lengths[lengths.length - 1];
  if (total === 0) return [points[0]];

  const step = total / (numPoints - 1);
  const out = [{ x: points[0].x, y: points[0].y }];
  let pi = 1;
  for (let i = 1; i < numPoints - 1; i++) {
    const target = i * step;
    while (pi < points.length - 1 && lengths[pi] < target) pi++;
    const s = lengths[pi - 1], e = lengths[pi];
    const t = e > s ? (target - s) / (e - s) : 0;
    out.push({
      x: points[pi-1].x + t * (points[pi].x - points[pi-1].x),
      y: points[pi-1].y + t * (points[pi].y - points[pi-1].y),
    });
  }
  out.push({ x: points[points.length-1].x, y: points[points.length-1].y });
  return out;
}

function smoothPoints(points, iterations = 2) {
  if (points.length <= 2) return points;
  let pts = points.map(p => ({ ...p }));
  for (let iter = 0; iter < iterations; iter++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      next.push({
        x: pts[i-1].x * 0.25 + pts[i].x * 0.5 + pts[i+1].x * 0.25,
        y: pts[i-1].y * 0.25 + pts[i].y * 0.5 + pts[i+1].y * 0.25,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function pointsToSvgPath(points) {
  if (!points.length) return '';
  // Use quadratic bezier curves for smoother paths instead of straight lines
  if (points.length <= 2) {
    let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    if (points.length === 2) {
      d += `L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
    }
    return d;
  }

  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;

  // For smoother SVG paths, use quadratic Bezier curves through midpoints
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (i < points.length - 2) {
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      d += `Q${curr.x.toFixed(2)},${curr.y.toFixed(2)},${midX.toFixed(2)},${midY.toFixed(2)}`;
    } else {
      // Last segment: just a line to the end
      d += `L${next.x.toFixed(2)},${next.y.toFixed(2)}`;
    }
  }

  return d;
}

function markCorners(points) {
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i-1].coords, curr = points[i].coords, next = points[i+1].coords;
    const a1 = Math.atan2(curr[1]-prev[1], curr[0]-prev[0]);
    const a2 = Math.atan2(next[1]-curr[1], next[0]-curr[0]);
    let diff = Math.abs(a2 - a1);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff > Math.PI / 4) points[i].corner = true;
  }
}
