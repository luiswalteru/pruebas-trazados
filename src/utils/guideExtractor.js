import { computeDistanceTransform } from './letterMask'

/**
 * Extract a "guide-dots" mask from a full-scene SVG/raster image.
 *
 * The typical input is a rich illustration (e.g. ejemplo/…/a_correct.svg)
 * that contains background, a character/mascot, the letter body, and a
 * sequence of small dark shapes that form the dotted tracing guide. We want
 * just those dots: rasterize → threshold to dark-grayscale ink → connected
 * components → discard the biggest blobs (letter body + character silhouette)
 * and the tiniest ones (noise) → return a mask that contains only the dots
 * plus its distance transform, so snapToCenterline pulls drawn points toward
 * the guide line rather than toward the letter body's skeleton.
 *
 * If the extraction collapses (no dots left, or fewer than a minimum), the
 * caller should fall back to the raw dark-pixel mask.
 *
 * @param {string} imageSrc  data URL / object URL — anything Image() accepts
 * @param {number} width     canvas/letter-space width
 * @param {number} height    canvas/letter-space height
 * @param {Object} [opts]
 * @param {number} [opts.darkLum=90]        luminance below which a pixel is "ink"
 * @param {number} [opts.maxSat=0.28]       max HSL-saturation (0..1) — excludes vivid character colors
 * @param {number} [opts.discardLargest=3]  drop the N biggest components (letter, character, shadows)
 * @param {number} [opts.minDotArea=3]      min pixel area for a surviving component
 * @param {number} [opts.maxDotFraction=0.15] max area as fraction of (largest) pre-discard component
 * @param {number} [opts.renderScale=2]     super-sample factor when rasterizing — denser dot pixels survive
 * @returns {Promise<{mask: Uint8Array, dist: Float32Array, width:number, height:number, debug: {dotCount:number, centroids: Array<{x:number,y:number,area:number}>}}>}
 */
export async function extractGuideMaskFromImage(imageSrc, width, height, opts = {}) {
  if (!imageSrc || !width || !height) return null

  const darkLum        = opts.darkLum        ?? 90
  const maxSat         = opts.maxSat         ?? 0.28
  const discardLargest = opts.discardLargest ?? 3
  const minDotArea     = opts.minDotArea     ?? 3
  const maxDotFraction = opts.maxDotFraction ?? 0.15
  const renderScale    = Math.max(1, Math.floor(opts.renderScale ?? 2))

  const img = await loadImage(imageSrc)
  const rw = width * renderScale
  const rh = height * renderScale

  // Render at higher resolution so small guide dots keep enough pixels to
  // survive thresholding; we downsample the final mask at the end. Uses
  // object-fit: contain semantics so the mask's coordinate system matches
  // the <img> preview the user draws over.
  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, rw, rh)

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

  // Binary "ink" mask: dark + low saturation (letter + guide dots, excluding
  // vivid character colors). Alpha must also be present.
  const bin = new Uint8Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a < 128) continue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum > darkLum) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat > maxSat) continue
    bin[i] = 1
  }

  // Connected components (8-connectivity, iterative flood fill).
  const components = floodFillComponents(bin, rw, rh)
  if (components.length === 0) return null

  components.sort((a, b) => b.area - a.area)

  // Everything above this cap is a "big shape" and gets dropped. We base the
  // cap on the component right after the discardLargest ones — anything still
  // larger than (that * 3) is noise we don't want.
  const afterDiscardIdx = Math.min(discardLargest, components.length - 1)
  const referenceArea = components[afterDiscardIdx]?.area ?? 0
  const absoluteMaxArea = Math.max(referenceArea * 3, minDotArea * 4)

  const largestArea = components[0].area
  const maxDotArea = Math.max(minDotArea + 1, largestArea * maxDotFraction)

  const kept = []
  for (let i = 0; i < components.length; i++) {
    if (i < discardLargest) continue // letter body / character / shadows
    const c = components[i]
    if (c.area < minDotArea) continue
    if (c.area > maxDotArea) continue
    if (c.area > absoluteMaxArea) continue
    kept.push(c)
  }

  if (kept.length === 0) return null

  // Build final mask in destination resolution (width x height).
  const mask = new Uint8Array(width * height)
  for (const c of kept) {
    for (let k = 0; k < c.pixels.length; k++) {
      const idx = c.pixels[k]
      const py = Math.floor(idx / rw)
      const px = idx - py * rw
      const dx = Math.floor(px / renderScale)
      const dy = Math.floor(py / renderScale)
      if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue
      mask[dy * width + dx] = 1
    }
  }

  // Slight dilation (one pass) so small dots translate into continuous mask
  // regions after downsampling — helps the distance-transform gradient stay
  // smooth between dots.
  const dilated = dilate(mask, width, height)
  const dist = computeDistanceTransform(dilated, width, height)

  const centroids = kept.map(c => ({
    x: (c.sumX / c.area) / renderScale,
    y: (c.sumY / c.area) / renderScale,
    area: c.area / (renderScale * renderScale),
  }))

  // Edges between centroids — K nearest neighbors with a distance cap at
  // ~2.5× the median nearest-neighbor distance. This gives a polyline
  // through the dotted guide that stays local (doesn't jump across letter
  // strokes or to isolated dots like the one on an "i").
  const edges = buildGuideEdges(centroids, { k: 2, distFactor: 2.5 })

  // Degree-1 vertices are the polyline's endpoints — used on stroke start to
  // disambiguate which end of a loop the user wants to begin at.
  const degree = new Int32Array(centroids.length)
  for (const { a, b } of edges) { degree[a]++; degree[b]++ }
  const endpoints = []
  for (let i = 0; i < degree.length; i++) {
    if (degree[i] === 1) endpoints.push(i)
  }

  return {
    mask: dilated,
    dist,
    width,
    height,
    centroids,
    edges,
    endpoints,
    debug: { dotCount: kept.length, centroids, edges, endpoints },
  }
}

function buildGuideEdges(centroids, { k = 2, distFactor = 2.5 } = {}) {
  if (centroids.length < 2) return []
  const n = centroids.length

  // Each centroid: list of (j, d) sorted ascending.
  const nearest = []
  const nnDist = [] // nearest-neighbor distance per centroid
  for (let i = 0; i < n; i++) {
    const list = []
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const dx = centroids[i].x - centroids[j].x
      const dy = centroids[i].y - centroids[j].y
      list.push({ j, d: Math.hypot(dx, dy) })
    }
    list.sort((a, b) => a.d - b.d)
    nearest.push(list)
    nnDist.push(list[0]?.d ?? 0)
  }

  const sorted = [...nnDist].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const maxEdge = median * distFactor

  const seen = new Set()
  const edges = []
  for (let i = 0; i < n; i++) {
    const neigh = nearest[i].slice(0, k)
    for (const { j, d } of neigh) {
      if (d > maxEdge && d > median * 1.5) continue
      const a = Math.min(i, j), b = Math.max(i, j)
      const key = `${a}-${b}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ a, b })
    }
  }
  return edges
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
      let sumX = 0, sumY = 0
      let area = 0

      while (stack.length > 0) {
        const j = stack.pop()
        if (labels[j] !== 0) continue
        labels[j] = label
        const jy = (j / width) | 0
        const jx = j - jy * width
        pixels.push(j)
        sumX += jx
        sumY += jy
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

      components.push({ label, area, pixels, sumX, sumY })
    }
  }
  return components
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

/** Quick data-URL sniff. */
export function isSvgSource(src) {
  if (!src) return false
  if (src.startsWith('data:image/svg+xml')) return true
  if (src.startsWith('<svg') || src.includes('<svg')) return true
  return /\.svg(\?|$)/i.test(src)
}
