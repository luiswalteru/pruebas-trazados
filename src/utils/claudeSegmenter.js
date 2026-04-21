/**
 * Anthropic Claude segmentation client.
 *
 * Alternative to the SAM / Replicate route: asks Claude (via the
 * `/__claude-segment` dev-server proxy) to look at the reference PNG and
 * output the centerline of the letter's white body as a JSON array of
 * segments, each made up of pixel-coordinate points along the stroke.
 *
 * Claude is not a pixel-perfect segmenter — its output is an estimate
 * made from its vision model's reasoning about the image. It'll be
 * rougher than SAM but works as a fallback provider when Replicate is
 * rate-limited or out of credit.
 *
 * Returns the data in the same `{ points, d }` shape as the local
 * `extractGuideMaskFromImage` `segments` output, so the drawer can drop
 * the result straight into its skeleton-based pipeline.
 */

// eslint-disable-next-line no-undef
export const CLAUDE_AVAILABLE = typeof __CLAUDE_ENABLED__ !== 'undefined' ? __CLAUDE_ENABLED__ : false

/**
 * @param {string} imageSrc   data URL of the PNG reference image
 * @param {number} width      letter-space canvas width (used for clamping)
 * @param {number} height     letter-space canvas height
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{segments: Array<{points: Array<{x:number,y:number}>, d:string}>} | null>}
 */
export async function getSegmentsViaClaude(imageSrc, width, height, opts = {}) {
  console.log('[claude] getSegmentsViaClaude entry', { hasImage: !!imageSrc, width, height, CLAUDE_AVAILABLE })
  if (!imageSrc || !width || !height) return null
  if (!CLAUDE_AVAILABLE) return null

  // We pass the RAW image dimensions to the prompt so Claude returns pixel
  // coords in that native space. The drawer rescales into letter-space.
  // Figure out the source image size by decoding briefly.
  const srcDims = await readImageDimensions(imageSrc)

  const res = await fetch('/__claude-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageSrc,
      width: srcDims.width,
      height: srcDims.height,
    }),
    signal: opts.signal,
  })

  console.log('[claude] /__claude-segment response', { status: res.status, ok: res.ok })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    if (res.status === 429) {
      const err = new Error(payload.error || 'Claude rate limited')
      err.rateLimited = true
      throw err
    }
    const detailStr = typeof payload.detail === 'string' ? payload.detail : ''
    if (res.status === 402 || /credit|billing/i.test(detailStr)) {
      const err = new Error('Claude insufficient credit')
      err.insufficientCredit = true
      throw err
    }
    const msg = payload.error || `Claude proxy ${res.status}`
    const err = new Error(payload.detail ? `${msg}: ${payload.detail}` : msg)
    err.httpStatus = res.status
    throw err
  }

  const data = await res.json()
  const rawSegments = Array.isArray(data?.segments) ? data.segments : []
  if (rawSegments.length === 0) return null

  // Scale Claude's pixel coords from the source image space into the
  // drawer's letter-space, assuming the source was rendered with
  // object-fit:contain just like the drawer's <img> layer.
  const { sx, sy, ox, oy } = fitScale(srcDims.width, srcDims.height, width, height)

  const segments = []
  for (const seg of rawSegments) {
    const raw = Array.isArray(seg?.points) ? seg.points : []
    if (raw.length < 2) continue
    const points = []
    for (const pt of raw) {
      const px = Array.isArray(pt) ? pt[0] : pt?.x
      const py = Array.isArray(pt) ? pt[1] : pt?.y
      if (typeof px !== 'number' || typeof py !== 'number') continue
      const x = px * sx + ox
      const y = py * sy + oy
      // Clamp to letter-space bounds so a hallucinated point off-canvas
      // doesn't blow up the rendering.
      points.push({
        x: Math.max(0, Math.min(width, x)),
        y: Math.max(0, Math.min(height, y)),
      })
    }
    if (points.length < 2) continue
    const d = pointsToSvgPath(points)
    segments.push({ points, d })
  }

  console.log(`[claude] converted ${segments.length} segment(s) into letter-space`)
  return segments.length > 0 ? { segments } : null
}

// =============================================================================
// Helpers
// =============================================================================

function readImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    img.onerror = reject
    img.src = src
  })
}

/**
 * Compute the scale+offset that maps source image coords into destination
 * letter-space using object-fit:contain semantics — the same rule the
 * drawer uses when rendering the PNG underneath the strokes.
 */
function fitScale(srcW, srcH, dstW, dstH) {
  const srcA = srcW / srcH
  const dstA = dstW / dstH
  let dw, dh, dx, dy
  if (srcA > dstA) { dw = dstW; dh = dstW / srcA; dx = 0; dy = (dstH - dh) / 2 }
  else             { dh = dstH; dw = dstH * srcA; dy = 0; dx = (dstW - dw) / 2 }
  return { sx: dw / srcW, sy: dh / srcH, ox: dx, oy: dy }
}

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
