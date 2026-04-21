/**
 * Google Gemini segmentation client.
 *
 * Same contract as the Claude segmenter, just a different backend. Gemini
 * Flash has a real free tier (1500 req/day, 15 req/min) with no credit
 * card required — a good fallback for users hitting paid-tier walls on
 * Replicate or Anthropic.
 *
 * Get an API key at https://aistudio.google.com/apikey and put it in
 * .env.local as GEMINI_API_KEY.
 */

// eslint-disable-next-line no-undef
export const GEMINI_AVAILABLE = typeof __GEMINI_ENABLED__ !== 'undefined' ? __GEMINI_ENABLED__ : false

/**
 * @param {string} imageSrc
 * @param {number} width
 * @param {number} height
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{segments: Array<{points: Array<{x:number,y:number}>, d:string}>} | null>}
 */
export async function getSegmentsViaGemini(imageSrc, width, height, opts = {}) {
  console.log('[gemini] getSegmentsViaGemini entry', { hasImage: !!imageSrc, width, height, GEMINI_AVAILABLE })
  if (!imageSrc || !width || !height) return null
  if (!GEMINI_AVAILABLE) return null

  const srcDims = await readImageDimensions(imageSrc)

  const res = await fetch('/__gemini-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageSrc,
      width: srcDims.width,
      height: srcDims.height,
    }),
    signal: opts.signal,
  })

  console.log('[gemini] /__gemini-segment response', { status: res.status, ok: res.ok })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    if (res.status === 429) {
      const err = new Error(payload.error || 'Gemini rate limited')
      err.rateLimited = true
      throw err
    }
    if (res.status === 503) {
      // Tras reintentos el servidor sigue saturado. Fail soft con banner
      // "servicio saturado" en vez de un error técnico crudo.
      const err = new Error('Gemini saturado (503) tras reintentos')
      err.overloaded = true
      throw err
    }
    const detailStr = typeof payload.detail === 'string' ? payload.detail : ''
    if (res.status === 402 || /credit|billing|quota/i.test(detailStr)) {
      const err = new Error('Gemini quota exceeded')
      err.insufficientCredit = true
      throw err
    }
    const msg = payload.error || `Gemini proxy ${res.status}`
    const err = new Error(payload.detail ? `${msg}: ${payload.detail}` : msg)
    err.httpStatus = res.status
    throw err
  }

  const data = await res.json()
  const rawSegments = Array.isArray(data?.segments) ? data.segments : []
  if (rawSegments.length === 0) return null

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
      points.push({
        x: Math.max(0, Math.min(width, x)),
        y: Math.max(0, Math.min(height, y)),
      })
    }
    if (points.length < 2) continue
    segments.push({ points, d: pointsToSvgPath(points) })
  }

  console.log(`[gemini] converted ${segments.length} segment(s) into letter-space`)
  return segments.length > 0 ? { segments } : null
}

// =============================================================================
// Helpers (same as claudeSegmenter — kept local for a zero-dependency util)
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
