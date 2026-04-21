/**
 * SAM 2 (Segment Anything) segmentation client.
 *
 * Uploads the PNG reference image to Replicate's hosted SAM 2 model via the
 * dev-server proxy (`/__sam-segment`), picks the output mask that best
 * corresponds to the white letter body, and returns it as a binary
 * Uint8Array ready to be fed into the rest of the guide-extraction pipeline.
 *
 * Why: threshold-based detection of the letter body (near-white pixels
 * segmented with flood-fill + hole-filling + morphological close) is
 * sensitive to anti-aliasing, marker colours and background tone. SAM
 * handles those natively and produces a crisp object mask.
 *
 * Falls back to null on any error. Callers should detect that and degrade
 * gracefully to the local extractor pipeline.
 */

// Replicate model to call. Can be overridden per-request via opts.model or
// globally via VITE_SAM_MODEL in .env.local.
const DEFAULT_MODEL = import.meta.env?.VITE_SAM_MODEL || 'meta/sam-2'

/**
 * Preset models the user can pick from in the selector. Order = default
 * fallback priority (try first, then second, then third…). "id" is the
 * Replicate slug; "label" is user-facing; "paid" is informational.
 *
 * Replicate community models come and go — if a slug 404s on resolve-version
 * the selector surfaces that and the user can swap to another preset or
 * type a custom slug.
 */
export const SAM_MODEL_PRESETS = [
  {
    id: 'meta/sam-2',
    label: 'SAM 2 (Meta, oficial) — paga',
    cost: '~$0.02/img',
    paid: true,
  },
  {
    id: 'schananas/grounded_sam',
    label: 'Grounded SAM (community, text prompt) — free tier',
    cost: 'Free tier',
    paid: false,
  },
  {
    id: 'lucataco/segment-anything-2',
    label: 'SAM 2 (community) — free tier',
    cost: 'Free tier',
    paid: false,
  },
]

// `__SAM_ENABLED__` is replaced at build time by vite.config.js with the
// boolean literal `true` when REPLICATE_API_TOKEN is present and `false`
// otherwise. Use this to cheaply short-circuit without even POSTing.
// eslint-disable-next-line no-undef
export const SAM_AVAILABLE = typeof __SAM_ENABLED__ !== 'undefined' ? __SAM_ENABLED__ : false

/**
 * @param {string} imageSrc  data URL / URL accepted by Image()
 * @param {number} width     target letter-space width
 * @param {number} height    target letter-space height
 * @param {Object} [opts]
 * @param {number} [opts.renderScale=2]   supersampling factor; output mask
 *                                         is rasterised at width × renderScale
 * @param {number} [opts.maskThreshold=128] luminance threshold on the mask
 *                                         PNG to decide foreground/background
 * @param {AbortSignal} [opts.signal]     abort the SAM request
 * @param {string} [opts.model]           Replicate slug to use (overrides DEFAULT_MODEL)
 * @returns {Promise<{mask: Uint8Array, width:number, height:number} | null>}
 */
export async function getLetterBodyMask(imageSrc, width, height, opts = {}) {
  const model = opts.model || DEFAULT_MODEL
  console.log('[sam] getLetterBodyMask entry', { hasImage: !!imageSrc, width, height, model, SAM_AVAILABLE })
  if (!imageSrc || !width || !height) return null
  if (!SAM_AVAILABLE) return null

  const renderScale = Math.max(1, Math.floor(opts.renderScale ?? 2))
  const threshold = opts.maskThreshold ?? 128

  // Run SAM in automatic mask-generation mode. It returns a list of masks,
  // one per discovered object: the letter body will be one of them, along
  // with any marker (arrows, numbers, coloured dots) large enough to count
  // as its own segment.
  console.log('[sam] POST /__sam-segment', { model })
  const res = await fetch('/__sam-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: {
        image: imageSrc,
        // meta/sam-2 auto-generation tuning. Lower points_per_side makes
        // SAM coarser (fewer masks, faster). 16 still finds the letter
        // reliably even for thin strokes.
        points_per_side: 16,
        pred_iou_thresh: 0.86,
        stability_score_thresh: 0.92,
      },
    }),
    signal: opts.signal,
  })
  console.log('[sam] /__sam-segment response', { status: res.status, ok: res.ok })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    // 429: rate-limited by Replicate free tier. Silent fallback to local.
    if (res.status === 429) {
      const err = new Error(payload.error || 'SAM rate limited')
      err.rateLimited = true
      throw err
    }
    // 402: Replicate requires a paid account for this model (meta/sam-2
    // doesn't come with free-tier credit). Distinct flag so the drawer
    // can render a helpful billing-link banner instead of a cryptic error.
    const detailStr = typeof payload.detail === 'string' ? payload.detail : ''
    if (res.status === 402 || /status"?:\s*402|Insufficient credit/i.test(detailStr)) {
      const err = new Error('SAM insufficient credit')
      err.insufficientCredit = true
      throw err
    }
    // Surface the detailed body from Replicate (schema validation,
    // unknown model, authentication, etc.) so the drawer can show it.
    const msg = payload.error || `SAM proxy ${res.status}`
    const err = new Error(payload.detail ? `${msg}: ${payload.detail}` : msg)
    err.httpStatus = res.status
    err.detail = payload.detail
    throw err
  }
  const { output } = await res.json()
  if (!output) return null

  // Replicate output shapes in the wild:
  //   • array of URLs           → individual masks
  //   • { individual_masks, combined_mask } → take individual_masks
  //   • single URL              → one mask
  let maskUrls = []
  if (Array.isArray(output)) maskUrls = output.filter(u => typeof u === 'string')
  else if (output && typeof output === 'object') {
    if (Array.isArray(output.individual_masks)) maskUrls = output.individual_masks
    else if (typeof output.combined_mask === 'string') maskUrls = [output.combined_mask]
    else {
      // Look for any string URL field as a last resort
      for (const v of Object.values(output)) {
        if (typeof v === 'string' && /^https?:/.test(v)) { maskUrls = [v]; break }
      }
    }
  } else if (typeof output === 'string') maskUrls = [output]

  if (maskUrls.length === 0) return null

  // Scale to supersampled resolution for cleaner skeleton downstream.
  const rw = width * renderScale
  const rh = height * renderScale

  // Rasterize the source image at the same resolution to score each mask
  // by how well it covers near-white pixels — the letter body lights up
  // far brighter than any marker.
  const sourceBrightness = await rasterizeSourceBrightness(imageSrc, rw, rh)

  // For each returned mask, rasterize it at rw×rh, binarize, and score.
  let bestMask = null
  let bestScore = -Infinity
  for (const url of maskUrls) {
    let binary
    try {
      binary = await rasterizeMaskToBinary(url, rw, rh, threshold)
    } catch (_) { continue }
    const score = scoreMask(binary, sourceBrightness, rw, rh)
    if (score > bestScore) { bestScore = score; bestMask = binary }
  }

  if (!bestMask) return null
  return { mask: bestMask, width: rw, height: rh, renderScale }
}

// =============================================================================
// Helpers
// =============================================================================

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Rasterize the source image at rw×rh (object-fit:contain, black letterbox)
 * and return its per-pixel brightness as a Uint8Array — used to score which
 * SAM mask contains the near-white letter body.
 */
async function rasterizeSourceBrightness(imageSrc, rw, rh) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, rw, rh)

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const srcA = iw / ih, dstA = rw / rh
  let dw, dh, dx, dy
  if (srcA > dstA) { dw = rw; dh = rw / srcA; dx = 0; dy = (rh - dh) / 2 }
  else             { dh = rh; dw = rh * srcA; dy = 0; dx = (rw - dw) / 2 }
  ctx.drawImage(img, dx, dy, dw, dh)

  const { data } = ctx.getImageData(0, 0, rw, rh)
  const out = new Uint8Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    // Perceptual luminance, 0..255
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return out
}

/** Download a mask PNG and rasterize/binarize it to rw×rh. */
async function rasterizeMaskToBinary(url, rw, rh, threshold) {
  const img = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, rw, rh)

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const srcA = iw / ih, dstA = rw / rh
  let dw, dh, dx, dy
  if (srcA > dstA) { dw = rw; dh = rw / srcA; dx = 0; dy = (rh - dh) / 2 }
  else             { dh = rh; dw = rh * srcA; dy = 0; dx = (rw - dw) / 2 }
  ctx.drawImage(img, dx, dy, dw, dh)

  const { data } = ctx.getImageData(0, 0, rw, rh)
  const mask = new Uint8Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    // SAM masks are monochrome — sampling the red channel is enough.
    if (data[i * 4] > threshold) mask[i] = 1
  }
  return mask
}

/**
 * Score a candidate mask. The letter body has three defining traits:
 *   • Most of its pixels are near-white (the stroke is the only white blob).
 *   • It's reasonably large (not a stray dot).
 *   • It doesn't cover the entire image (rules out the "whole scene" mask
 *     that auto-gen sometimes emits).
 *
 * Score = (sum of brightness for mask-pixels) / (mask area ^ 0.2), then
 * penalised if the mask covers >80% of the image. The exponent keeps very
 * large but slightly-bright masks (e.g. the full letter silhouette) from
 * dominating over small masks that are uniformly bright.
 */
function scoreMask(mask, brightness, rw, rh) {
  const N = rw * rh
  let area = 0, brightSum = 0
  for (let i = 0; i < N; i++) {
    if (mask[i] !== 1) continue
    area++
    brightSum += brightness[i]
  }
  if (area === 0) return -Infinity
  const coverage = area / N
  if (coverage > 0.85) return -Infinity
  const avgBright = brightSum / area
  // Favour masks that are mostly white-ish. Threshold below 160 (teal + dark
  // markers) gets a big score penalty.
  if (avgBright < 160) return -Infinity
  // Mild area preference so tiny bright specks don't beat the real body.
  return avgBright * Math.sqrt(area)
}
