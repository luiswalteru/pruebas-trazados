import { computeDistanceTransform } from './letterMask'

/**
 * Extract a tracing guide from a PNG reference image that shows the letter
 * body in near-white pixels against a coloured background (see
 * `ejemplo/trazado-letra-a/trazado_a.png` for the canonical shape).
 *
 * Pipeline:
 *   1. Rasterize the image onto a super-sampled canvas (renderScale×) with
 *      object-fit: contain semantics so the coordinate system matches the
 *      <img> preview the user draws over.
 *   2. Binarize: keep pixels whose min(R,G,B) >= minWhite and whose alpha is
 *      opaque — this isolates the white letter body and rejects the coloured
 *      background, the arrows (dark), the numbers (dark) and any accent dots
 *      in the original illustration.
 *   3. Keep only large connected components (drop tiny specks introduced by
 *      anti-aliasing or stray white marks).
 *   4. Skeletonize with Zhang-Suen thinning → one-pixel-wide centerline.
 *   5. Build a polyline graph directly from the skeleton: each skeleton pixel
 *      becomes a centroid; 8-connected neighbours become edges. Degree-1
 *      vertices are endpoints.
 *   6. Return the high-res skeleton mask downsampled to letter-space plus the
 *      distance transform, so the legacy distance-field snap can still run as
 *      a fallback if the graph is too sparse.
 *
 * Returns null when nothing white was detected (caller falls back to the
 * plain dark-pixel mask from letterMask.js).
 *
 * @param {string} imageSrc  data URL / object URL — anything Image() accepts
 * @param {number} width     canvas/letter-space width
 * @param {number} height    canvas/letter-space height
 * @param {Object} [opts]
 * @param {number} [opts.minWhite=235]      min of R,G,B for a pixel to count as letter body
 * @param {number} [opts.minArea=80]        min pixel area for a kept component (in high-res pixels)
 * @param {number} [opts.minComponentRatio=0.25] keep components with area >= largest*ratio
 *                                           (0.25 keeps accent dots like 'i' but rejects tiny
 *                                           white specks from arrows/numbers)
 * @param {number} [opts.closePasses=1]     morphological close passes (dilate→erode) to fill
 *                                           anti-aliasing cracks and smooth the outline
 * @param {number} [opts.maxSpurLength=6]   prune skeleton spurs shorter than this (high-res px).
 *                                           Kept small so legitimate short strokes (cursive tails,
 *                                           crossbars, serifs) aren't mistaken for outline bumps.
 * @param {number} [opts.maxHoleFraction=0.08] fill enclosed holes whose area is below
 *                                           bodyArea × this fraction. Small enough to catch
 *                                           arrows/number/dots drawn over the letter, large
 *                                           enough that the bowl of an 'a'/'o'/'e' stays hollow.
 * @param {number} [opts.renderScale=2]     super-sample factor when rasterizing
 * @returns {Promise<{mask: Uint8Array, dist: Float32Array, width:number, height:number, centroids: Array<{x:number,y:number}>, edges: Array<{a:number,b:number}>, endpoints: Array<number>, segments: Array<{points,d:string}>, debug: Object} | null>}
 */
export async function extractGuideMaskFromImage(imageSrc, width, height, opts = {}) {
  if (!imageSrc || !width || !height) return null

  const minWhite           = opts.minWhite           ?? 235
  const minArea            = opts.minArea            ?? 80
  const minComponentRatio  = opts.minComponentRatio  ?? 0.25
  const closePasses        = Math.max(0, opts.closePasses ?? 1)
  const maxSpurLength      = Math.max(0, opts.maxSpurLength ?? 6)
  const maxHoleFraction    = Math.max(0, opts.maxHoleFraction ?? 0.08)
  const renderScale        = Math.max(1, Math.floor(opts.renderScale ?? 2))

  const img = await loadImage(imageSrc)
  const rw = width * renderScale
  const rh = height * renderScale

  // Rasterize with object-fit: contain, filling the padding with solid black
  // so transparent image edges don't accidentally count as "white".
  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, rw, rh)

  const iw = img.naturalWidth || img.width || rw
  const ih = img.naturalHeight || img.height || rh
  const srcAspect = iw / ih
  const dstAspect = rw / rh
  let dw, dh, dx, dy
  if (srcAspect > dstAspect) {
    dw = rw
    dh = rw / srcAspect
    dx = 0
    dy = (rh - dh) / 2
  } else {
    dw = rh * srcAspect
    dh = rh
    dx = (rw - dw) / 2
    dy = 0
  }
  ctx.drawImage(img, dx, dy, dw, dh)
  const { data } = ctx.getImageData(0, 0, rw, rh)

  // Binary "letter body" mask: near-white + opaque.
  const bin = new Uint8Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a < 128) continue
    if (r < minWhite || g < minWhite || b < minWhite) continue
    bin[i] = 1
  }

  // Connected components. Drop tiny specks; keep the letter body and any
  // large accent dot (e.g. the dot over an 'i'), but reject the small white
  // bits of arrows/numbers that occasionally cross the threshold.
  const components = floodFillComponents(bin, rw, rh)
  if (components.length === 0) return null

  components.sort((a, b) => b.area - a.area)
  const largestArea = components[0].area
  const areaCutoff = Math.max(minArea, largestArea * minComponentRatio)
  const kept = components.filter(c => c.area >= areaCutoff)
  if (kept.length === 0) return null

  // Rebuild mask in high-res from kept components.
  let bodyMask = new Uint8Array(rw * rh)
  for (const c of kept) {
    for (let k = 0; k < c.pixels.length; k++) bodyMask[c.pixels[k]] = 1
  }

  // Fill SMALL enclosed non-white regions — arrows, numbers, the red "1"
  // starter dot, coloured accent dots, etc., drawn on top of the letter body
  // leave small holes in the white mask and the skeleton routes around them.
  // Big enclosed regions (the bowl of an 'a'/'o'/'e' when the letter is a
  // hollow outline, not a solid fill) must NOT be filled — doing so collapses
  // the letter into a disc and the skeleton becomes a dot in the middle.
  // The threshold is a fraction of the body's own pixel area.
  const bodyArea = bodyMask.reduce((s, v) => s + v, 0)
  if (bodyArea > 0 && maxHoleFraction > 0) {
    const maxHolePixels = Math.max(1, Math.floor(bodyArea * maxHoleFraction))
    fillSmallEnclosedHoles(bodyMask, rw, rh, maxHolePixels)
  }

  // Morphological close (dilate → erode) smooths the boundary and fills tiny
  // cracks left by anti-aliasing. Without this step, a jagged boundary turns
  // into a branchy Zhang-Suen skeleton with lots of spurs.
  for (let p = 0; p < closePasses; p++) {
    bodyMask = dilateGrid(bodyMask, rw, rh)
  }
  for (let p = 0; p < closePasses; p++) {
    bodyMask = erodeGrid(bodyMask, rw, rh)
  }

  // Zhang-Suen thinning produces a one-pixel-wide skeleton in-place.
  const skelMask = new Uint8Array(bodyMask)
  zhangSuenThin(skelMask, rw, rh)

  // Even with a smoothed body, small bumps in the outline produce short spurs
  // off the main centerline. Prune them so the skeleton is the clean thickness
  // axis we want as the dashed guide.
  if (maxSpurLength > 0) pruneSkeletonSpurs(skelMask, rw, rh, maxSpurLength)

  // Zhang-Suen shaves 1-2 pixels off every endpoint as a side effect of the
  // thinning rules, so the skeleton never quite reaches the tips of the
  // letter's strokes. Extrapolate each endpoint along the direction of its
  // last few skeleton pixels until we leave the body mask — this makes the
  // dashed guide actually reach the end of each stroke.
  extendSkeletonEndpoints(skelMask, bodyMask, rw, rh)

  // Collect skeleton pixels → centroids (letter-space coords).
  const pixIndexToCentroid = new Int32Array(rw * rh)
  pixIndexToCentroid.fill(-1)
  const centroids = []
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (skelMask[i] !== 1) continue
      pixIndexToCentroid[i] = centroids.length
      centroids.push({ x: x / renderScale, y: y / renderScale })
    }
  }
  if (centroids.length < 2) return null

  // Edges: 8-connectivity between skeleton pixels. Walk only "forward"
  // neighbours (those with a larger pixel index) to avoid duplicates.
  const edges = []
  const degree = new Int32Array(centroids.length)
  const FWD = [
    [1, 0],   // right
    [-1, 1],  // down-left
    [0, 1],   // down
    [1, 1],   // down-right
  ]
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (skelMask[i] !== 1) continue
      const aIdx = pixIndexToCentroid[i]
      for (const [ddx, ddy] of FWD) {
        const nx = x + ddx, ny = y + ddy
        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue
        const ni = ny * rw + nx
        if (skelMask[ni] !== 1) continue
        const bIdx = pixIndexToCentroid[ni]
        edges.push({ a: aIdx, b: bIdx })
        degree[aIdx]++
        degree[bIdx]++
      }
    }
  }

  const endpoints = []
  for (let i = 0; i < degree.length; i++) {
    if (degree[i] === 1) endpoints.push(i)
  }

  // High-level centerline segments: split the skeleton at junctions, merge
  // segments that cross a junction almost in a straight line, drop spurs,
  // orient each segment (top→bottom / left→right) and sort top-first. These
  // become the dashed-guide <path>s rendered on the drawing canvas and
  // emitted as letter-dotted.svg.
  const segments = extractCenterlineSegments(skelMask, rw, rh, renderScale)

  // Downsampled mask + distance transform (kept for the legacy centerline
  // pull in case a caller asks for it — projectStrokeOnGuide doesn't use it).
  const maskLow = new Uint8Array(width * height)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (skelMask[y * rw + x] !== 1) continue
      const lx = Math.floor(x / renderScale)
      const ly = Math.floor(y / renderScale)
      if (lx < 0 || lx >= width || ly < 0 || ly >= height) continue
      maskLow[ly * width + lx] = 1
    }
  }
  const dilated = dilate(maskLow, width, height)
  const dist = computeDistanceTransform(dilated, width, height)

  return {
    mask: dilated,
    dist,
    width,
    height,
    centroids,
    edges,
    endpoints,
    segments,
    debug: {
      dotCount: centroids.length,
      centroids,
      edges,
      endpoints,
      segments,
    },
  }
}

// =============================================================================
// CENTERLINE SEGMENTS — split the skeleton at junctions and build smoothed
// polylines per stroke, in letter-space coordinates. Each segment is ready
// to render as a dashed <path> guide or to export as part of letter-dotted.svg.
// =============================================================================

function extractCenterlineSegments(skelMask, rw, rh, renderScale) {
  // Classify each skeleton pixel by neighbour count.
  const ENDPOINT = 1, NORMAL = 2, JUNCTION = 3
  const kind = new Uint8Array(rw * rh)
  const junctions = []
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (skelMask[i] !== 1) continue
      const nb = skeletonNeighbourCount(skelMask, x, y, rw, rh)
      if (nb <= 1) kind[i] = ENDPOINT
      else if (nb >= 3) { kind[i] = JUNCTION; junctions.push({ x, y }) }
      else kind[i] = NORMAL
    }
  }

  // Working copy: remove junction pixels so connected components become
  // individual segments without branching.
  const work = new Uint8Array(skelMask)
  for (const j of junctions) work[j.y * rw + j.x] = 0

  // Trace connected components, preferring to start from endpoints so
  // open-ended segments get traced in the "natural" direction.
  const visited = new Uint8Array(rw * rh)
  const rawSegments = []
  const startOrder = []
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (skelMask[i] === 1 && kind[i] === ENDPOINT) startOrder.push({ x, y })
    }
  }
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (skelMask[i] === 1 && kind[i] !== JUNCTION) startOrder.push({ x, y })
    }
  }

  for (const sp of startOrder) {
    const idx = sp.y * rw + sp.x
    if (visited[idx] || work[idx] === 0) continue
    const seg = traceConnected(work, visited, sp.x, sp.y, rw, rh)
    if (seg.length >= 2) rawSegments.push(seg)
  }

  // Re-attach each junction pixel to any segment end it touches (≤ 1 px away
  // in Chebyshev distance). This stitches the pieces back across junctions.
  for (const j of junctions) {
    for (const seg of rawSegments) {
      const first = seg[0]
      const last = seg[seg.length - 1]
      if (Math.max(Math.abs(j.x - first.x), Math.abs(j.y - first.y)) <= 1) {
        seg.unshift({ x: j.x, y: j.y })
      } else if (Math.max(Math.abs(j.x - last.x), Math.abs(j.y - last.y)) <= 1) {
        seg.push({ x: j.x, y: j.y })
      }
    }
  }

  // Raster → letter-space.
  let segs = rawSegments.map(seg =>
    seg.map(p => ({ x: p.x / renderScale, y: p.y / renderScale }))
  )

  segs = mergeCollinearSegments(segs)
  segs = filterShortSegments(segs, 0.05)
  segs = orientAndOrderSegments(segs)

  const out = []
  for (const seg of segs) {
    if (seg.length < 3) continue
    const smoothed = smoothPolyline(seg, 5)
    const d = pointsToSvgPath(smoothed)
    out.push({ points: smoothed, d })
  }
  return out
}

function skeletonNeighbourCount(grid, x, y, w, h) {
  let c = 0
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy
    if (ny < 0 || ny >= h) continue
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      if (nx < 0 || nx >= w) continue
      if (grid[ny * w + nx] === 1) c++
    }
  }
  return c
}

// Greedy chain-follow: walk neighbours preferring direction continuity.
function traceConnected(grid, visited, sx, sy, w, h) {
  const path = []
  let cx = sx, cy = sy
  const dx8 = [0, 1, 1, 1, 0, -1, -1, -1]
  const dy8 = [-1, -1, 0, 1, 1, 1, 0, -1]

  while (true) {
    const idx = cy * w + cx
    if (visited[idx]) break
    if (grid[idx] === 0) break
    visited[idx] = 1
    path.push({ x: cx, y: cy })

    let bestX = -1, bestY = -1, bestScore = -Infinity
    let dirX = 0, dirY = 0
    if (path.length >= 2) {
      const prev = path[path.length - 2]
      dirX = cx - prev.x; dirY = cy - prev.y
      const len = Math.hypot(dirX, dirY)
      if (len) { dirX /= len; dirY /= len }
    }

    for (let i = 0; i < 8; i++) {
      const nx = cx + dx8[i], ny = cy + dy8[i]
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = ny * w + nx
      if (grid[ni] === 0 || visited[ni]) continue
      const score = dirX * dx8[i] + dirY * dy8[i]
      if (score > bestScore) { bestScore = score; bestX = nx; bestY = ny }
    }
    if (bestX < 0) break
    cx = bestX; cy = bestY
  }
  return path
}

function mergeCollinearSegments(segments) {
  if (segments.length <= 1) return segments
  const merged = segments.map(s => s.map(p => ({ ...p })))
  let didMerge = true
  const maxEndGap = 4
  const collinearAngle = Math.PI / 6 // ≤ 30°

  while (didMerge) {
    didMerge = false
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j]
        if (a.length < 2 || b.length < 2) continue
        const combos = [
          { aEnd: 'last',  bEnd: 'first', d: ptDist(a[a.length-1], b[0]) },
          { aEnd: 'last',  bEnd: 'last',  d: ptDist(a[a.length-1], b[b.length-1]) },
          { aEnd: 'first', bEnd: 'first', d: ptDist(a[0], b[0]) },
          { aEnd: 'first', bEnd: 'last',  d: ptDist(a[0], b[b.length-1]) },
        ]
        for (const c of combos) {
          if (c.d > maxEndGap) continue
          const dirA = c.aEnd === 'last'
            ? sub(a[a.length-1], a[Math.max(0, a.length - 6)])
            : sub(a[0], a[Math.min(a.length-1, 5)])
          const dirB = c.bEnd === 'first'
            ? sub(b[Math.min(b.length-1, 5)], b[0])
            : sub(b[Math.max(0, b.length - 6)], b[b.length-1])
          if (angleBetween(dirA, dirB) > collinearAngle) continue

          let newSeg
          if (c.aEnd === 'last' && c.bEnd === 'first') newSeg = [...a, ...b]
          else if (c.aEnd === 'last' && c.bEnd === 'last') newSeg = [...a, ...[...b].reverse()]
          else if (c.aEnd === 'first' && c.bEnd === 'first') newSeg = [...[...a].reverse(), ...b]
          else newSeg = [...[...a].reverse(), ...[...b].reverse()]

          merged[i] = newSeg
          merged.splice(j, 1)
          didMerge = true
          break outer
        }
      }
    }
  }
  return merged
}

function filterShortSegments(segments, ratio = 0.08) {
  if (segments.length <= 1) return segments
  const withLen = segments.map(seg => ({ seg, len: polylineLength(seg) }))
  const maxLen = Math.max(...withLen.map(s => s.len))
  if (maxLen === 0) return segments
  const threshold = maxLen * ratio
  const kept = withLen.filter(s => s.len >= threshold).map(s => s.seg)
  return kept.length > 0 ? kept : [segments[0]]
}

function orientAndOrderSegments(segments) {
  if (segments.length === 0) return []
  const oriented = segments.map(seg => {
    const first = seg[0]
    const last = seg[seg.length - 1]
    const dy = Math.abs(last.y - first.y)
    const dx = Math.abs(last.x - first.x)
    let needsFlip = false
    if (dy > dx * 0.5) needsFlip = last.y < first.y       // vertical: top first
    else needsFlip = last.x < first.x                     // horizontal: left first
    return needsFlip ? [...seg].reverse() : seg
  })
  oriented.sort((a, b) => {
    const ay = a[0].y, by = b[0].y
    if (Math.abs(ay - by) > 5) return ay - by
    return a[0].x - b[0].x
  })
  return oriented
}

function smoothPolyline(points, iterations = 2) {
  if (points.length <= 2) return points.map(p => ({ x: p.x, y: p.y }))
  let pts = points.map(p => ({ x: p.x, y: p.y }))
  for (let iter = 0; iter < iterations; iter++) {
    const next = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      next.push({
        x: pts[i-1].x * 0.25 + pts[i].x * 0.5 + pts[i+1].x * 0.25,
        y: pts[i-1].y * 0.25 + pts[i].y * 0.5 + pts[i+1].y * 0.25,
      })
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

// Quadratic-bezier "d": smoother visual when rendered dashed than plain M+L.
function pointsToSvgPath(points) {
  if (!points.length) return ''
  if (points.length <= 2) {
    let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
    if (points.length === 2) d += `L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`
    return d
  }
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i], next = points[i + 1]
    if (i < points.length - 2) {
      const mx = (curr.x + next.x) / 2, my = (curr.y + next.y) / 2
      d += `Q${curr.x.toFixed(2)},${curr.y.toFixed(2)},${mx.toFixed(2)},${my.toFixed(2)}`
    } else {
      d += `L${next.x.toFixed(2)},${next.y.toFixed(2)}`
    }
  }
  return d
}

function polylineLength(seg) {
  let len = 0
  for (let i = 1; i < seg.length; i++) {
    len += Math.hypot(seg[i].x - seg[i-1].x, seg[i].y - seg[i-1].y)
  }
  return len
}

function ptDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y } }
function angleBetween(a, b) {
  const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y)
  if (la === 0 || lb === 0) return 0
  const dot = (a.x * b.x + a.y * b.y) / (la * lb)
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

/**
 * Snap a point onto the nearest guide-polyline segment, biased by recent
 * stroke history so the snap doesn't teleport to a spatially-close but
 * topologically-far part of the polyline (e.g. the opposite side of the
 * loop in a cursive "a").
 *
 * Two biasing modes:
 *   • With `history` (≥2 points): use the averaged direction of the last
 *     few steps to penalise the **lateral** (perpendicular-to-motion) part
 *     of (proj − tip). Forward motion is free; sideways jumps are costly.
 *     Backward motion gets a mild penalty so the snap doesn't reverse
 *     direction spuriously.
 *   • With only `prev` (or history length 1): penalise (proj − prev)²
 *     isotropically with `continuityBias`.
 *
 * @param {{x:number,y:number}} point
 * @param {Array<{x:number,y:number}>} centroids
 * @param {Array<{a:number,b:number}>} edges
 * @param {Object} [opts]
 * @param {number} [opts.maxDist=80]
 * @param {{x:number,y:number}} [opts.prev]
 * @param {Array<{x:number,y:number}>} [opts.history]     projected points so far (for prev ref)
 * @param {Array<{x:number,y:number}>} [opts.rawHistory]  raw cursor path (for direction estimate)
 * @param {number} [opts.lateralBias=2.5]   weight of lateral² penalty
 * @param {number} [opts.backwardPenalty=0.4] weight on negative-forward² penalty
 * @param {number} [opts.continuityBias=0.3]  fallback weight when no direction is available
 * @param {number} [opts.dirLookback=15]    accumulated arc-length (px) to span when estimating direction
 */
export function snapToPolyline(point, centroids, edges, opts = {}) {
  if (!centroids || centroids.length === 0 || !edges || edges.length === 0) {
    return { x: point.x, y: point.y }
  }
  const maxDist          = opts.maxDist ?? 80
  const maxD2            = maxDist * maxDist
  const history          = opts.history
  const rawHistory       = opts.rawHistory
  const prev             = opts.prev || (history && history.length > 0 ? history[history.length - 1] : null)
  const lateralBias      = opts.lateralBias ?? 2.5
  const backwardPenalty  = opts.backwardPenalty ?? 0.4
  const continuityBias   = opts.continuityBias ?? 0.3
  const dirLookback      = opts.dirLookback ?? 15

  // Motion direction. Prefer the raw cursor path (the user's intent) over
  // the already-projected history, since a previous mis-projection onto the
  // wrong side of a loop would otherwise skew the direction and keep us on
  // the wrong side by feedback. Walks back along the path until ~dirLookback
  // px of cumulative distance so slow/dense sampling doesn't give a near-
  // zero, unreliable direction.
  let dxh = 0, dyh = 0, hasDir = false
  const dirSource = (rawHistory && rawHistory.length >= 2) ? rawHistory : history
  if (dirSource && dirSource.length >= 2) {
    const tip = dirSource[dirSource.length - 1]
    let back = tip
    let acc = 0
    for (let i = dirSource.length - 2; i >= 0; i--) {
      acc += Math.hypot(back.x - dirSource[i].x, back.y - dirSource[i].y)
      back = dirSource[i]
      if (acc >= dirLookback) break
    }
    const dx = tip.x - back.x, dy = tip.y - back.y
    const len = Math.hypot(dx, dy)
    if (len > 1) { dxh = dx / len; dyh = dy / len; hasDir = true }
  }

  let bestScore = Infinity
  let best = null
  for (const e of edges) {
    const A = centroids[e.a]
    const B = centroids[e.b]
    if (!A || !B) continue
    const proj = projectPointOnSegment(point, A, B)
    const ex = proj.x - point.x
    const ey = proj.y - point.y
    const d2 = ex * ex + ey * ey
    if (d2 > maxD2) continue

    let score = d2
    if (hasDir && prev) {
      const rx = proj.x - prev.x
      const ry = proj.y - prev.y
      const forward = rx * dxh + ry * dyh
      const latX = rx - forward * dxh
      const latY = ry - forward * dyh
      score += lateralBias * (latX * latX + latY * latY)
      if (forward < 0) score += backwardPenalty * forward * forward
    } else if (prev) {
      const px = proj.x - prev.x
      const py = proj.y - prev.y
      score += continuityBias * (px * px + py * py)
    }
    if (score < bestScore) { bestScore = score; best = proj }
  }
  if (!best) return { x: point.x, y: point.y }
  return best
}

/**
 * Snap to the nearest polyline endpoint (degree-1 centroid). Used on stroke
 * start so the stroke begins where the guide begins/ends, not in the middle
 * of a segment that may be spatially close but topologically far away.
 * Returns null if no endpoint is within `maxDist`.
 */
export function snapToEndpoint(point, centroids, endpoints, opts = {}) {
  if (!centroids || !endpoints || endpoints.length === 0) return null
  const maxDist = opts.maxDist ?? 40
  const maxD2 = maxDist * maxDist
  let best = null
  let bestD2 = Infinity
  for (const idx of endpoints) {
    const c = centroids[idx]
    if (!c) continue
    const dx = c.x - point.x
    const dy = c.y - point.y
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) { bestD2 = d2; best = c }
  }
  if (!best || bestD2 > maxD2) return null
  return { x: best.x, y: best.y }
}

/**
 * Project an entire stroke (array of raw points) onto the guide polyline.
 * The first point tries to snap to a polyline endpoint; the rest are
 * projected with a direction-aware bias built from the already-projected
 * points, so the resulting stroke stays on one side of a loop instead of
 * jumping across when the cursor drifted inward.
 *
 * A light "no backtracking" smoothing pass runs at the end: each point is
 * pulled toward the average of its neighbours to remove small oscillations
 * left by sample-to-sample projection switching.
 */
export function projectStrokeOnGuide(points, guide, opts = {}) {
  if (!guide || !guide.edges || guide.edges.length === 0) return points
  if (!points || points.length < 2) return points
  const { centroids, edges, endpoints } = guide
  const endpointRadius = opts.endpointRadius ?? 50
  const maxDist        = opts.maxDist        ?? 120

  const out = []

  // First point: snap to the nearest polyline endpoint if one is close,
  // otherwise free projection.
  const first = points[0]
  let firstProj = null
  if (endpoints && endpoints.length > 0) {
    firstProj = snapToEndpoint(first, centroids, endpoints, { maxDist: endpointRadius })
  }
  if (!firstProj) {
    firstProj = snapToPolyline(first, centroids, edges, { maxDist })
  }
  out.push(firstProj)

  // Subsequent points: direction from the raw cursor path (user intent),
  // prev ref from the projected history. A past mis-projection can't drag
  // the estimator into a feedback loop this way.
  for (let i = 1; i < points.length; i++) {
    const history = out.slice(-5)
    const rawHistory = points.slice(Math.max(0, i - 10), i + 1)
    const proj = snapToPolyline(points[i], centroids, edges, { history, rawHistory, maxDist })
    out.push(proj)
  }

  // Last point: also snap to endpoint if close, so strokes that end at a
  // polyline extreme land cleanly on it.
  if (endpoints && endpoints.length > 0 && out.length >= 2) {
    const lastRaw = points[points.length - 1]
    const lastEp = snapToEndpoint(lastRaw, centroids, endpoints, { maxDist: endpointRadius })
    if (lastEp) out[out.length - 1] = lastEp
  }

  // Light neighbour-averaging to smooth out tiny sample-to-sample jitter
  // introduced when consecutive projections fall on different segments.
  return smoothAlongLine(out, 2)
}

function smoothAlongLine(pts, iterations) {
  if (pts.length < 3 || iterations <= 0) return pts
  let cur = pts.map(p => ({ x: p.x, y: p.y }))
  for (let it = 0; it < iterations; it++) {
    const next = [cur[0]]
    for (let i = 1; i < cur.length - 1; i++) {
      next.push({
        x: cur[i - 1].x * 0.25 + cur[i].x * 0.5 + cur[i + 1].x * 0.25,
        y: cur[i - 1].y * 0.25 + cur[i].y * 0.5 + cur[i + 1].y * 0.25,
      })
    }
    next.push(cur[cur.length - 1])
    cur = next
  }
  return cur
}

function projectPointOnSegment(p, A, B) {
  const vx = B.x - A.x, vy = B.y - A.y
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return { x: A.x, y: A.y }
  const wx = p.x - A.x, wy = p.y - A.y
  let t = (vx * wx + vy * wy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return { x: A.x + t * vx, y: A.y + t * vy }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * 8-connectivity connected components via iterative flood fill.
 * Each component stores its pixel indices so we can rebuild the mask later.
 */
function floodFillComponents(bin, width, height) {
  const N = width * height
  const labels = new Int32Array(N)
  const components = []
  let label = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (bin[i] !== 1 || labels[i] !== 0) continue

      label++
      const stack = [i]
      const pixels = []
      let area = 0

      while (stack.length > 0) {
        const j = stack.pop()
        if (labels[j] !== 0) continue
        labels[j] = label
        const jy = (j / width) | 0
        const jx = j - jy * width
        pixels.push(j)
        area++

        // 8-neighborhood
        for (let dy = -1; dy <= 1; dy++) {
          const ny = jy + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = jx + dx
            if (nx < 0 || nx >= width) continue
            const ni = ny * width + nx
            if (bin[ni] === 1 && labels[ni] === 0) stack.push(ni)
          }
        }
      }

      components.push({ label, area, pixels })
    }
  }
  return components
}

/**
 * Zhang-Suen thinning: repeatedly peels boundary pixels in two sub-iterations
 * until the result is one pixel wide. Operates in-place on a Uint8Array grid
 * where 1 = foreground. Border pixels (width==0 column/row) are untouched;
 * inputs shouldn't have foreground on the border or results will be noisy.
 */
function zhangSuenThin(grid, w, h) {
  let changed = true
  while (changed) {
    changed = false
    const r1 = []
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!grid[y * w + x]) continue
      const n = n8(grid, x, y, w)
      const B = sumN(n)
      if (B < 2 || B > 6) continue
      if (tr01(n) !== 1) continue
      if (n[0] * n[2] * n[4] === 0 && n[2] * n[4] * n[6] === 0)
        r1.push(y * w + x)
    }
    for (const i of r1) { grid[i] = 0; changed = true }

    const r2 = []
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!grid[y * w + x]) continue
      const n = n8(grid, x, y, w)
      const B = sumN(n)
      if (B < 2 || B > 6) continue
      if (tr01(n) !== 1) continue
      if (n[0] * n[2] * n[6] === 0 && n[0] * n[4] * n[6] === 0)
        r2.push(y * w + x)
    }
    for (const i of r2) { grid[i] = 0; changed = true }
  }
}

//  7  0  1
//  6  X  2
//  5  4  3
function n8(grid, x, y, w) {
  return [
    grid[(y-1)*w+x], grid[(y-1)*w+x+1], grid[y*w+x+1], grid[(y+1)*w+x+1],
    grid[(y+1)*w+x], grid[(y+1)*w+x-1], grid[y*w+x-1], grid[(y-1)*w+x-1],
  ]
}
function sumN(n) { return n[0]+n[1]+n[2]+n[3]+n[4]+n[5]+n[6]+n[7] }
function tr01(n) {
  let c = 0
  for (let i = 0; i < 8; i++) if (n[i] === 0 && n[(i+1)%8] === 1) c++
  return c
}

/** One-pass 3×3 dilation. */
function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (mask[i] === 1) { out[i] = 1; continue }
      let hit = 0
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (mask[ny * width + nx] === 1) hit = 1
        }
      }
      out[i] = hit
    }
  }
  return out
}

/** One-pass 3×3 dilation (alias used by the morphological close step). */
function dilateGrid(mask, width, height) {
  return dilate(mask, width, height)
}

/**
 * Fill enclosed non-body regions whose pixel count is ≤ maxHolePixels. The
 * bowls of hollow letters (cursive 'a', 'o', 'e', 'p', etc. where only the
 * outline is drawn in white) are enclosed too, but much larger than any
 * symbol mark, so they remain untouched. Operates in-place.
 *
 * Algorithm:
 *   1. Flood-fill 4-connectivity from every border 0-pixel → "outside".
 *   2. For every 0-pixel not marked outside, BFS its connected region.
 *   3. If the region's area ≤ maxHolePixels, flip all its pixels to 1.
 *
 * 4-connectivity for the background is the standard dual to 8-connectivity
 * foreground (the letter body was segmented with 8-conn), so a hole that
 * only touches the outside through a diagonal gap still counts as enclosed.
 */
function fillSmallEnclosedHoles(mask, w, h, maxHolePixels) {
  const N = w * h
  const outside = new Uint8Array(N)
  const stack = []

  // Seed: every 0-pixel on the image border is "outside".
  for (let x = 0; x < w; x++) {
    if (mask[x] === 0)                { outside[x] = 1; stack.push(x) }
    const bi = (h - 1) * w + x
    if (mask[bi] === 0)               { outside[bi] = 1; stack.push(bi) }
  }
  for (let y = 0; y < h; y++) {
    const li = y * w
    if (mask[li] === 0)               { outside[li] = 1; stack.push(li) }
    const ri = y * w + w - 1
    if (mask[ri] === 0)               { outside[ri] = 1; stack.push(ri) }
  }

  // 4-connected flood fill through the 0-pixels to classify "outside".
  while (stack.length > 0) {
    const i = stack.pop()
    const y = (i / w) | 0
    const x = i - y * w
    if (x > 0) {
      const ni = i - 1
      if (mask[ni] === 0 && !outside[ni]) { outside[ni] = 1; stack.push(ni) }
    }
    if (x < w - 1) {
      const ni = i + 1
      if (mask[ni] === 0 && !outside[ni]) { outside[ni] = 1; stack.push(ni) }
    }
    if (y > 0) {
      const ni = i - w
      if (mask[ni] === 0 && !outside[ni]) { outside[ni] = 1; stack.push(ni) }
    }
    if (y < h - 1) {
      const ni = i + w
      if (mask[ni] === 0 && !outside[ni]) { outside[ni] = 1; stack.push(ni) }
    }
  }

  // For each enclosed non-body region, measure it and fill only if small.
  const visited = new Uint8Array(N)
  for (let start = 0; start < N; start++) {
    if (mask[start] !== 0 || outside[start] || visited[start]) continue
    const comp = []
    const bfs = [start]
    visited[start] = 1
    while (bfs.length > 0) {
      const j = bfs.pop()
      comp.push(j)
      const y = (j / w) | 0
      const x = j - y * w
      if (x > 0) {
        const nj = j - 1
        if (mask[nj] === 0 && !outside[nj] && !visited[nj]) { visited[nj] = 1; bfs.push(nj) }
      }
      if (x < w - 1) {
        const nj = j + 1
        if (mask[nj] === 0 && !outside[nj] && !visited[nj]) { visited[nj] = 1; bfs.push(nj) }
      }
      if (y > 0) {
        const nj = j - w
        if (mask[nj] === 0 && !outside[nj] && !visited[nj]) { visited[nj] = 1; bfs.push(nj) }
      }
      if (y < h - 1) {
        const nj = j + w
        if (mask[nj] === 0 && !outside[nj] && !visited[nj]) { visited[nj] = 1; bfs.push(nj) }
      }
    }
    if (comp.length <= maxHolePixels) {
      for (const j of comp) mask[j] = 1
    }
  }
}

/** One-pass 3×3 erosion: a pixel stays 1 only if all 8 neighbours are 1. */
function erodeGrid(mask, width, height) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (mask[i] !== 1) continue
      let all1 = 1
      for (let dy = -1; dy <= 1 && all1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) { all1 = 0; break }
        for (let dx = -1; dx <= 1 && all1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) { all1 = 0; break }
          if (mask[ny * width + nx] !== 1) all1 = 0
        }
      }
      out[i] = all1
    }
  }
  return out
}

/**
 * Prune spurs from a Zhang-Suen skeleton in-place.
 *
 * A "spur" is a short branch that starts at a degree-1 skeleton pixel
 * (endpoint) and ends at a degree-≥3 pixel (junction). These are typically
 * produced by small bumps on the letter's outline — they're not part of the
 * real medial axis and make the dashed guide look branchy.
 *
 * Walks outward from every endpoint, counting steps. If we reach a junction
 * within `maxSpurLength` steps, the whole walked chain is a spur and gets
 * erased. If we never reach a junction (it's a genuine open-ended branch
 * like the tail of a cursive 'a') we leave it alone. Iterates until no more
 * spurs are found, since erasing one spur can expose a new endpoint further
 * up the chain.
 *
 * @param {Uint8Array} skel   skeleton mask, modified in-place
 * @param {number} w
 * @param {number} h
 * @param {number} maxSpurLength   longest spur to prune, in high-res pixels
 */
function pruneSkeletonSpurs(skel, w, h, maxSpurLength) {
  let changed = true
  while (changed) {
    changed = false
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (skel[y * w + x] !== 1) continue
        if (skeletonNeighbourCount(skel, x, y, w, h) !== 1) continue

        // Walk forward from this endpoint, recording the chain.
        const chain = [{ x, y }]
        let prevX = -1, prevY = -1
        let cx = x, cy = y
        let reachedJunction = false

        while (chain.length <= maxSpurLength + 1) {
          let nextX = -1, nextY = -1
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx, ny = cy + dy
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
              if (skel[ny * w + nx] !== 1) continue
              if (nx === prevX && ny === prevY) continue
              if (nextX !== -1) {
                // More than one unvisited neighbour → current pixel is the
                // junction we were looking for. The chain so far (excluding
                // current) is the spur.
                reachedJunction = true
                break
              }
              nextX = nx; nextY = ny
            }
            if (reachedJunction) break
          }
          if (reachedJunction) break
          if (nextX === -1) break // chain ended without reaching a junction
          const nnb = skeletonNeighbourCount(skel, nextX, nextY, w, h)
          if (nnb >= 3) {
            reachedJunction = true
            break
          }
          chain.push({ x: nextX, y: nextY })
          prevX = cx; prevY = cy
          cx = nextX; cy = nextY
        }

        if (reachedJunction && chain.length <= maxSpurLength) {
          for (const p of chain) skel[p.y * w + p.x] = 0
          changed = true
        }
      }
    }
  }
}

/**
 * Extrapolate each skeleton endpoint along its local direction until it
 * leaves the body mask. Operates in-place on `skel`.
 *
 * Zhang-Suen peels endpoint pixels as a side effect of its thinning rules,
 * so the skeleton falls short of the real stroke tips. We walk the last few
 * skeleton pixels to estimate the outgoing direction, then step along that
 * direction one pixel at a time, painting each position onto the skeleton
 * for as long as we stay inside `body`. The step halts on leaving the body,
 * hitting another skeleton pixel, or running out of room.
 */
function extendSkeletonEndpoints(skel, body, w, h, maxExtend = 60, backSteps = 6) {
  const endpoints = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (skel[y * w + x] !== 1) continue
      if (skeletonNeighbourCount(skel, x, y, w, h) === 1) endpoints.push({ x, y })
    }
  }

  for (const ep of endpoints) {
    // Walk backwards along the skeleton to estimate the outgoing direction.
    const back = []
    let prevX = -1, prevY = -1
    let cx = ep.x, cy = ep.y
    back.push({ x: cx, y: cy })
    for (let s = 0; s < backSteps; s++) {
      let nx = -1, ny = -1
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const tx = cx + dx, ty = cy + dy
          if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue
          if (skel[ty * w + tx] !== 1) continue
          if (tx === prevX && ty === prevY) continue
          nx = tx; ny = ty
          break outer
        }
      }
      if (nx < 0) break
      back.push({ x: nx, y: ny })
      prevX = cx; prevY = cy
      cx = nx; cy = ny
    }
    if (back.length < 2) continue

    const tail = back[back.length - 1]
    const vx = ep.x - tail.x
    const vy = ep.y - tail.y
    const len = Math.hypot(vx, vy)
    if (len < 0.5) continue
    const ux = vx / len, uy = vy / len

    // Step outward from the endpoint. Use fractional stepping so diagonal
    // extensions paint contiguous pixels.
    let lastPX = ep.x, lastPY = ep.y
    for (let step = 1; step <= maxExtend; step++) {
      const fx = ep.x + ux * step
      const fy = ep.y + uy * step
      const nx = Math.round(fx)
      const ny = Math.round(fy)
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) break
      if (body[ny * w + nx] !== 1) break
      if (nx === lastPX && ny === lastPY) continue
      if (skel[ny * w + nx] === 1) break
      skel[ny * w + nx] = 1
      lastPX = nx; lastPY = ny
    }
  }
}
