import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Dev-only middleware: POST /__write-reader-trazado
 *
 * Body: { type: 'ligada'|'mayusculas', folderName: 'trazado-letra-a', files: {...} }
 * Each files entry is either a plain string (utf-8 text) or { base64: '...' }
 * (binary — used for thum.png). Writes everything to
 * public/reader/libro/assets/trazados/{type}/{folderName}/.
 *
 * Used by "Preview en reader" in the generator wizard so a just-built trazado
 * can be tested inside the reader without going through the ZIP-download flow.
 */
function readerWriterPlugin() {
  const ALLOWED_TYPES = new Set(['ligada', 'mayusculas'])
  const FOLDER_RE = /^trazado-letra-[a-z0-9-]+$/i
  const FILE_RE = /^[a-zA-Z0-9._-]+$/

  return {
    name: 'reader-writer',
    configureServer(server) {
      server.middlewares.use('/__write-reader-trazado', (req, res, next) => {
        if (req.method !== 'POST') return next()

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { type, folderName, files } = body
            if (!ALLOWED_TYPES.has(type)) throw new Error(`invalid type: ${type}`)
            if (!FOLDER_RE.test(folderName)) throw new Error(`invalid folderName: ${folderName}`)
            if (!files || typeof files !== 'object') throw new Error('missing files')

            const targetDir = path.resolve(
              server.config.root,
              'public/reader/libro/assets/trazados',
              type,
              folderName,
            )
            fs.mkdirSync(targetDir, { recursive: true })

            const written = []
            for (const [name, value] of Object.entries(files)) {
              if (!FILE_RE.test(name)) throw new Error(`invalid file name: ${name}`)
              const filePath = path.join(targetDir, name)
              if (value && typeof value === 'object' && typeof value.base64 === 'string') {
                fs.writeFileSync(filePath, Buffer.from(value.base64, 'base64'))
              } else if (typeof value === 'string') {
                fs.writeFileSync(filePath, value, 'utf8')
              } else {
                throw new Error(`invalid file value for ${name}`)
              }
              written.push(name)
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: targetDir, written }))
          } catch (err) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err?.message || 'bad request' }))
          }
        })
      })
    },
  }
}

/**
 * Dev-only middleware: POST /__sam-segment
 *
 * Thin proxy that calls Replicate's Predictions API so the REPLICATE_API_TOKEN
 * never reaches the browser. Accepts a JSON body with:
 *   { model: 'owner/name', input: { ... } }
 * and forwards it to POST https://api.replicate.com/v1/models/{model}/predictions
 * (which targets the model's latest version). Polls the prediction every second
 * until it reaches a terminal state, then returns the prediction JSON as-is —
 * the client knows which `output` field to read for its chosen model.
 *
 * Only active when REPLICATE_API_TOKEN is set in the env. Without a token the
 * endpoint responds with 501 so the client can cleanly fall back to the local
 * guideExtractor pipeline.
 */
function samSegmentPlugin(env) {
  const TOKEN = env.REPLICATE_API_TOKEN
  const MAX_WAIT_MS = 90_000
  const MAX_CREATE_RETRIES = 2
  const FETCH_TIMEOUT_MS = 30_000

  // Resolved `latest_version.id` per model, so we don't re-hit
  // GET /v1/models/{owner}/{name} on every prediction.
  const versionCache = new Map()

  // fetch wrapper with an AbortSignal-backed timeout. Any individual
  // Replicate call that hangs >30s throws a timeout error so the whole
  // request can fail fast instead of hanging the browser spinner.
  async function fetchWithTimeout(url, opts = {}, label = 'fetch') {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error(`${label} timeout`)), FETCH_TIMEOUT_MS)
    // Chain the caller's signal to our internal one so either can abort.
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort(opts.signal.reason)
      else opts.signal.addEventListener('abort', () => ctl.abort(opts.signal.reason))
    }
    try {
      return await fetch(url, { ...opts, signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  // Replicate has two endpoints for creating predictions:
  //   • /v1/models/{owner}/{name}/predictions  — "Official models" shortcut
  //   • /v1/predictions with { version, input } — works for ANY public model
  //
  // meta/sam-2 (and most community models) return 404 on the shortcut, so we
  // always resolve the latest version hash via /v1/models/{owner}/{name} and
  // use the generic endpoint. The hash is cached in memory for the life of
  // the dev server.
  async function resolveVersion(model, signal) {
    if (versionCache.has(model)) return versionCache.get(model)
    const r = await fetchWithTimeout(
      `https://api.replicate.com/v1/models/${model}`,
      { headers: { 'Authorization': `Token ${TOKEN}` }, signal },
      `GET /v1/models/${model}`,
    )
    const text = await r.text()
    if (!r.ok) {
      console.error(`[sam-segment] resolve model ${model} → ${r.status}:`, text)
      throw new Error(`resolve ${model} ${r.status}: ${text}`)
    }
    const json = JSON.parse(text)
    const id = json.latest_version?.id
    if (!id) throw new Error(`model ${model} has no latest_version`)
    versionCache.set(model, id)
    return id
  }

  // Free-tier Replicate accounts without a payment method are limited to
  // ~6 requests / minute with a burst of 1. When we hit the limit Replicate
  // returns 429 with { retry_after: N } in the JSON body (also a Retry-After
  // header). Honour that delay and retry a couple of times before giving
  // up — the client then silently falls back to the local extractor.
  async function createPrediction(model, input, signal) {
    console.log(`[sam-segment] resolving version for ${model}…`)
    const version = await resolveVersion(model, signal)
    console.log(`[sam-segment] version ${version.slice(0, 12)}… ready; POST /v1/predictions`)

    let lastStatus = 0
    let lastText = ''
    for (let attempt = 0; attempt <= MAX_CREATE_RETRIES; attempt++) {
      // No `Prefer: wait=*` — create returns immediately (201 + status:"starting")
      // and we poll. Keeps the flow predictable and avoids long-hung connections
      // during the create call.
      const r = await fetchWithTimeout(
        'https://api.replicate.com/v1/predictions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ version, input }),
          signal,
        },
        'POST /v1/predictions',
      )
      const text = await r.text()
      console.log(`[sam-segment] create attempt ${attempt + 1} → ${r.status}`)
      if (r.status !== 429) return { status: r.status, text }

      lastStatus = 429; lastText = text
      if (attempt === MAX_CREATE_RETRIES) break

      let delaySec = 11
      try {
        const parsed = JSON.parse(text)
        if (typeof parsed.retry_after === 'number') delaySec = parsed.retry_after
      } catch (_) { /* ignore */ }
      const header = r.headers.get('retry-after')
      if (header) delaySec = Math.max(delaySec, Number(header) || delaySec)
      await new Promise(res => setTimeout(res, (delaySec + 1) * 1000))
    }
    return { status: lastStatus, text: lastText }
  }

  return {
    name: 'sam-segment',
    configureServer(server) {
      server.middlewares.use('/__sam-segment', (req, res, next) => {
        if (req.method !== 'POST') return next()

        if (!TOKEN) {
          res.statusCode = 501
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'REPLICATE_API_TOKEN not set' }))
          return
        }

        // Upstream AbortController. We only abort on timeouts inside
        // fetchWithTimeout — NOT on `req.on('close')`, because Node emits
        // that event on IncomingMessage after the request body is fully
        // consumed regardless of whether the client is still connected
        // waiting for a response. Relying on it caused false-positive
        // aborts mid-flight.
        const upstream = new AbortController()
        let responded = false

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { model, input } = body
            if (!model || typeof model !== 'string') throw new Error('missing model')
            if (!input || typeof input !== 'object') throw new Error('missing input')
            console.log(`[sam-segment] received request for model ${model}`)

            const { status: createStatus, text: createText } = await createPrediction(model, input, upstream.signal)
            if (createStatus === 429) {
              res.statusCode = 429
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'replicate rate limited', detail: createText }))
              return
            }
            if (createStatus < 200 || createStatus >= 300) {
              // Full body goes to the Vite terminal so developers can see
              // exactly what Replicate complained about (schema mismatch,
              // unknown model, invalid token, etc.).
              console.error(`[sam-segment] replicate create ${createStatus}:`, createText)
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                error: `replicate create ${createStatus}`,
                status: createStatus,
                detail: createText,
              }))
              return
            }
            let prediction
            try { prediction = JSON.parse(createText) }
            catch (_) { throw new Error(`replicate create: invalid JSON response`) }

            const started = Date.now()
            let pollNum = 0
            console.log(`[sam-segment] prediction ${prediction.id} created; polling…`)
            while (prediction.status === 'starting' || prediction.status === 'processing') {
              if (upstream.signal.aborted) throw new DOMException('aborted', 'AbortError')
              if (Date.now() - started > MAX_WAIT_MS) throw new Error('timeout waiting for prediction')
              await new Promise(r => setTimeout(r, 1500))
              pollNum++
              const pollRes = await fetchWithTimeout(prediction.urls.get, {
                headers: { 'Authorization': `Token ${TOKEN}` },
                signal: upstream.signal,
              }, `GET prediction ${prediction.id}`)
              if (!pollRes.ok) throw new Error(`replicate poll ${pollRes.status}`)
              prediction = await pollRes.json()
              console.log(`[sam-segment] poll ${pollNum} → ${prediction.status}`)
            }

            if (prediction.status !== 'succeeded') {
              console.error('[sam-segment] prediction failed:', JSON.stringify(prediction, null, 2))
              throw new Error(`prediction ${prediction.status}: ${prediction.error || 'unknown'}`)
            }

            console.log(`[sam-segment] prediction ${prediction.id} succeeded; responding`)
            responded = true
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ output: prediction.output }))
          } catch (err) {
            if (err?.name === 'AbortError') {
              console.log('[sam-segment] aborted')
              return
            }
            console.error('[sam-segment] proxy error:', err)
            if (!responded) {
              responded = true
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err?.message || 'proxy error' }))
            }
          }
        })
      })
    },
  }
}

/**
 * Dev-only middleware: POST /__claude-segment
 *
 * Thin proxy that calls Anthropic's Messages API with vision so
 * ANTHROPIC_API_KEY never reaches the browser. Takes { image, width, height }
 * from the client, asks Claude to return the centerline of the white letter
 * body as JSON {"segments":[{"points":[[x,y],...]}]}, and forwards the
 * parsed JSON back.
 *
 * Returns 501 when ANTHROPIC_API_KEY is not set, so the client can
 * detect the provider is unavailable and fall back cleanly.
 */
function claudeSegmentPlugin(env) {
  const KEY = env.ANTHROPIC_API_KEY
  const MODEL = env.VITE_CLAUDE_MODEL || 'claude-sonnet-4-6'
  const MAX_TOKENS = 4096
  const FETCH_TIMEOUT_MS = 45_000

  async function fetchWithTimeout(url, opts = {}, label = 'fetch') {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error(`${label} timeout`)), FETCH_TIMEOUT_MS)
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort(opts.signal.reason)
      else opts.signal.addEventListener('abort', () => ctl.abort(opts.signal.reason))
    }
    try { return await fetch(url, { ...opts, signal: ctl.signal }) }
    finally { clearTimeout(timer) }
  }

  return {
    name: 'claude-segment',
    configureServer(server) {
      server.middlewares.use('/__claude-segment', (req, res, next) => {
        if (req.method !== 'POST') return next()

        if (!KEY) {
          res.statusCode = 501
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }))
          return
        }

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          let responded = false
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { image, width, height } = body
            if (!image || typeof image !== 'string') throw new Error('missing image')
            if (!width || !height) throw new Error('missing dimensions')

            // Extract base64 payload from data URL (Anthropic wants the
            // base64 bytes + media type separately).
            const m = image.match(/^data:image\/(\w+);base64,(.+)$/)
            if (!m) throw new Error('image must be a base64 data URL')
            const mediaType = `image/${m[1]}`
            const b64 = m[2]

            const prompt = `This is a ${width}×${height} pixel reference image for a cursive letter tracing exercise.

The image shows a cursive letter drawn as a thick white stroke on a coloured background. It may include arrows, numbers, and coloured dots as visual hints — IGNORE those marks; they are not part of the letter.

Task: return the CENTERLINE of the white letter body — the path a pen would follow to trace the letter along the thickness axis of the stroke. Split into multiple segments if the letter has multiple pen lifts (e.g. "t" = vertical + crossbar, "i" = body + dot).

Output format: strict JSON, no markdown, no commentary. Shape:
{"segments":[{"points":[[x1,y1],[x2,y2],...]}, ...]}

Where each [x,y] is an integer pixel coordinate in the image (0,0 = top-left, ${width - 1},${height - 1} = bottom-right). Each segment should have 20-40 points from start to end. Order the segments in the natural writing sequence (top-first, then left-to-right).

Only JSON. Nothing else.`

            console.log(`[claude-segment] received ${width}×${height} image (${b64.length} b64 chars); calling ${MODEL}`)
            const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
                    { type: 'text', text: prompt },
                  ],
                }],
              }),
            }, 'POST /v1/messages')

            const text = await r.text()
            console.log(`[claude-segment] anthropic response → ${r.status}`)
            if (!r.ok) {
              console.error('[claude-segment] anthropic error body:', text)
              res.statusCode = r.status === 429 ? 429 : 502
              res.setHeader('Content-Type', 'application/json')
              responded = true
              res.end(JSON.stringify({
                error: `anthropic ${r.status}`,
                status: r.status,
                detail: text,
              }))
              return
            }

            const payload = JSON.parse(text)
            const out = payload?.content?.[0]?.text || ''
            // Claude sometimes wraps JSON in code fences despite "no markdown";
            // tolerate that by stripping ``` blocks.
            const clean = out.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
            let parsed
            try { parsed = JSON.parse(clean) }
            catch (_) {
              throw new Error(`claude returned non-JSON: ${clean.slice(0, 200)}`)
            }

            console.log(`[claude-segment] parsed ${parsed.segments?.length ?? 0} segment(s); responding`)
            responded = true
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(parsed))
          } catch (err) {
            if (err?.name === 'AbortError') {
              console.log('[claude-segment] aborted')
              return
            }
            console.error('[claude-segment] proxy error:', err)
            if (!responded) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err?.message || 'proxy error' }))
            }
          }
        })
      })
    },
  }
}

/**
 * Dev-only middleware: POST /__gemini-segment
 *
 * Thin proxy that calls Google's Gemini generativelanguage API so
 * GEMINI_API_KEY never reaches the browser. Same contract as
 * /__claude-segment — input { image, width, height }, output
 * { segments: [{ points: [[x,y],...] }, ...] } — so the client can treat
 * any vision-LLM provider interchangeably.
 *
 * Gemini Flash has a generous free tier (1500 req/day, 15 req/min) with
 * no credit card required — ideal fallback when Replicate/Anthropic are
 * exhausted or unavailable.
 */
function geminiSegmentPlugin(env) {
  const KEY = env.GEMINI_API_KEY
  const MODEL = env.VITE_GEMINI_MODEL || 'gemini-2.5-flash'
  const FETCH_TIMEOUT_MS = 45_000
  const MAX_TRANSIENT_RETRIES = 3

  async function fetchWithTimeout(url, opts = {}, label = 'fetch') {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error(`${label} timeout`)), FETCH_TIMEOUT_MS)
    if (opts.signal) {
      if (opts.signal.aborted) ctl.abort(opts.signal.reason)
      else opts.signal.addEventListener('abort', () => ctl.abort(opts.signal.reason))
    }
    try { return await fetch(url, { ...opts, signal: ctl.signal }) }
    finally { clearTimeout(timer) }
  }

  // Gemini Flash free tier returns 503 UNAVAILABLE whenever Google's
  // backend is under load — common during peak hours. It's transient, so
  // exponential backoff (2s, 4s, 8s) with up to 3 retries resolves most
  // of them without the user seeing an error. 502/504 (gateway issues)
  // are treated the same way.
  async function callWithTransientRetry(url, opts, label) {
    const transient = new Set([502, 503, 504])
    let lastStatus = 0, lastText = ''
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      const r = await fetchWithTimeout(url, opts, label)
      const text = await r.text()
      if (!transient.has(r.status)) return { status: r.status, text }

      lastStatus = r.status
      lastText = text
      if (attempt === MAX_TRANSIENT_RETRIES) break

      const delayMs = 2000 * Math.pow(2, attempt) // 2s, 4s, 8s
      console.warn(`[gemini-segment] ${r.status} transient error; retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
      await new Promise(res => setTimeout(res, delayMs))
    }
    return { status: lastStatus, text: lastText }
  }

  return {
    name: 'gemini-segment',
    configureServer(server) {
      server.middlewares.use('/__gemini-segment', (req, res, next) => {
        if (req.method !== 'POST') return next()

        if (!KEY) {
          res.statusCode = 501
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'GEMINI_API_KEY not set' }))
          return
        }

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          let responded = false
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { image, width, height } = body
            if (!image || typeof image !== 'string') throw new Error('missing image')
            if (!width || !height) throw new Error('missing dimensions')

            const m = image.match(/^data:image\/(\w+);base64,(.+)$/)
            if (!m) throw new Error('image must be a base64 data URL')
            const mimeType = `image/${m[1]}`
            const b64 = m[2]

            const prompt = `This is a ${width}×${height} pixel reference image for a cursive letter tracing exercise.

The image shows a cursive letter drawn as a thick white stroke on a coloured background. It may include arrows, numbers, and coloured dots as visual hints — IGNORE those marks; they are not part of the letter.

Task: return the CENTERLINE of the white letter body — the path a pen would follow to trace the letter along the thickness axis of the stroke. Split into multiple segments if the letter has multiple pen lifts (e.g. "t" = vertical + crossbar, "i" = body + dot).

Output format: strict JSON, no markdown, no commentary. Shape:
{"segments":[{"points":[[x1,y1],[x2,y2],...]}, ...]}

Where each [x,y] is an integer pixel coordinate in the image (0,0 = top-left, ${width - 1},${height - 1} = bottom-right). Each segment should have 20-40 points from start to end. Order the segments in the natural writing sequence (top-first, then left-to-right).

Only JSON. Nothing else.`

            console.log(`[gemini-segment] received ${width}×${height} image; calling ${MODEL}`)
            const { status, text } = await callWithTransientRetry(
              `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [
                      { inline_data: { mime_type: mimeType, data: b64 } },
                      { text: prompt },
                    ],
                  }],
                  generationConfig: {
                    response_mime_type: 'application/json',
                    temperature: 0.2,
                  },
                }),
              },
              'POST gemini generateContent',
            )

            console.log(`[gemini-segment] gemini response → ${status}`)
            if (status < 200 || status >= 300) {
              console.error('[gemini-segment] gemini error body:', text)
              res.statusCode = status === 429 || status === 503 ? status : 502
              res.setHeader('Content-Type', 'application/json')
              responded = true
              res.end(JSON.stringify({
                error: `gemini ${status}`,
                status: status,
                detail: text,
              }))
              return
            }

            const payload = JSON.parse(text)
            const out = payload?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            const clean = out.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
            let parsed
            try { parsed = JSON.parse(clean) }
            catch (_) {
              throw new Error(`gemini returned non-JSON: ${clean.slice(0, 200)}`)
            }

            console.log(`[gemini-segment] parsed ${parsed.segments?.length ?? 0} segment(s); responding`)
            responded = true
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(parsed))
          } catch (err) {
            if (err?.name === 'AbortError') {
              console.log('[gemini-segment] aborted')
              return
            }
            console.error('[gemini-segment] proxy error:', err)
            if (!responded) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err?.message || 'proxy error' }))
            }
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      readerWriterPlugin(),
      samSegmentPlugin(env),
      claudeSegmentPlugin(env),
      geminiSegmentPlugin(env),
    ],
    server: {
      port: 5173,
      open: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    define: {
      __SAM_ENABLED__: JSON.stringify(!!env.REPLICATE_API_TOKEN),
      __CLAUDE_ENABLED__: JSON.stringify(!!env.ANTHROPIC_API_KEY),
      __GEMINI_ENABLED__: JSON.stringify(!!env.GEMINI_API_KEY),
    },
  }
})
