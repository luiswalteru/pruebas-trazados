import { useState, useRef, useCallback, useEffect } from 'react'
import { buildMaskFromImage, centerStrokePoints } from '../utils/letterMask'
import {
  extractGuideMaskFromImage,
  projectStrokeOnGuide,
} from '../utils/guideExtractor'
import { getLetterBodyMask, SAM_AVAILABLE, SAM_MODEL_PRESETS } from '../utils/samSegmenter'
import { getSegmentsViaClaude, CLAUDE_AVAILABLE } from '../utils/claudeSegmenter'
import { getSegmentsViaGemini, GEMINI_AVAILABLE } from '../utils/geminiSegmenter'

/**
 * ManualPathDrawer
 *
 * Allows the user to draw tracing paths manually on a canvas that shows
 * the letter shape as a visual guide.
 *
 * Mouse / touch:
 *   • Mouse-down  → starts a new stroke
 *   • Mouse-move  → records points while pressed
 *   • Mouse-up    → ends the current stroke
 *   • Click again → starts another stroke (multi-stroke letters)
 *
 * Keyboard shortcuts (displayed in the UI):
 *   • N           → force-end current stroke and start a new one
 *   • Ctrl+Z      → undo last stroke
 *   • Enter       → finalize and save
 *   • Escape      → cancel / clear all
 *
 * Props:
 *   letter        – the letter being drawn (for display)
 *   type          – 'ligada' | 'mayusculas'
 *   imageSrc      – optional raster image (dataURL or URL) shown as guide and
 *                   used to build the binary mask for centerline snapping
 *   width         – canvas width in letter-space units
 *   height        – canvas height in letter-space units
 *   dotCount      – how many dots to resample each stroke to
 *   dotSize       – dot size for the data.json
 *   onComplete    – callback({ dotList, strokePaths }) when user finalizes
 *   onCancel      – callback when user cancels
 */
export default function ManualPathDrawer({
  letter = '',
  type = 'ligada',
  imageSrc = '',
  width = 380,
  height = 340,
  dotCount = 40,
  dotSize = 33,
  dottedStrokeWidth = 5,
  dottedDash = 7,
  dottedGap = 11,
  samModels = null,
  aiProvider = 'sam',
  onComplete,
  onCancel,
}) {
  const SCALE = 1.4
  console.log('[drawer] render', { letter, imageLen: imageSrc?.length, width, height, SAM_AVAILABLE })
  const containerRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState([])           // finished strokes: Array<Array<{x,y}>>
  const [currentStroke, setCurrentStroke] = useState([]) // points of the stroke being drawn
  const [cursorPos, setCursorPos] = useState(null)
  const maskRef = useRef(null)                         // rasterized letter mask for center-snapping
  const guideRef = useRef(null)                        // { centroids, edges } for polyline snap
  // Skeleton segments extracted from the letter body. Rendered as the
  // always-visible dashed tracing guide, and also emitted in onComplete so
  // the generator can use them as letter-dotted.svg paths.
  const [skeletonSegments, setSkeletonSegments] = useState([])
  // Debug state for the SVG guide extractor — lets us see which blobs were
  // classified as guide dots so thresholds can be tuned if the segmentation
  // misses or over-picks.
  const [guideDebug, setGuideDebug] = useState(null)   // { dotCount, centroids, edges } | null
  const [showGuideDebug, setShowGuideDebug] = useState(false)
  const [maskMode, setMaskMode] = useState('none')     // 'skeleton' | 'fallback' | 'none'

  // Project a just-finished stroke onto the guide. Runs on mouse release
  // (endStroke) and when the user clicks "Centrar trazado". The raw drawing
  // is kept untouched during motion so the cursor feels free; the adjustment
  // happens once we have the full trajectory.
  //   • SVG guide with polyline → project each point with direction-aware bias.
  //   • Raster-only (PNG/JPG fallback) → iterative distance-transform snap.
  //   • No guide at all → leave the stroke as-is.
  const adjustStrokeToGuide = useCallback((points) => {
    const g = guideRef.current
    if (g && g.edges && g.edges.length > 0) {
      return projectStrokeOnGuide(points, g)
    }
    if (maskRef.current) {
      return centerStrokePoints(points, maskRef.current)
    }
    return points
  }, [])

  const displayLetter = type === 'mayusculas' ? letter.toUpperCase() : letter.toLowerCase()

  // Build the mask when the reference image (PNG) changes. Preferred path is
  // SAM 2 via the dev-server proxy (/__sam-segment): we ask Replicate for a
  // letter-body segmentation, feed that into the local extractor as its
  // externalBodyMask, and skip the fragile near-white threshold entirely.
  // If SAM is disabled (no REPLICATE_API_TOKEN) or fails (network / 502 /
  // bad mask) we drop to the local threshold pipeline, and finally to the
  // raster distance-field pull if even that yields no polyline.
  const [samLoading, setSamLoading] = useState(false)
  const [samCurrentModel, setSamCurrentModel] = useState(null)   // model being tried right now
  const [samProgress, setSamProgress] = useState({ idx: 0, total: 0 }) // "2 of 3"
  const [samRateLimited, setSamRateLimited] = useState(false)
  const [samInsufficientCredit, setSamInsufficientCredit] = useState(false)
  const [samOverloaded, setSamOverloaded] = useState(false)
  const [samError, setSamError] = useState(null)
  useEffect(() => {
    let cancelled = false
    // AbortController cancels the in-flight SAM fetch on cleanup. This
    // matters in React StrictMode (dev): the effect runs → cleanup →
    // runs again, and without abort() both passes would hit Replicate.
    const samController = new AbortController()
    maskRef.current = null
    guideRef.current = null
    setGuideDebug(null)
    setMaskMode('none')
    setSkeletonSegments([])
    setSamLoading(false)
    setSamCurrentModel(null)
    setSamProgress({ idx: 0, total: 0 })
    setSamRateLimited(false)
    setSamInsufficientCredit(false)
    setSamOverloaded(false)
    setSamError(null)
    if (!imageSrc) return

    const effectId = Math.random().toString(36).slice(2, 7)
    console.log(`[drawer ${effectId}] effect setup`, {
      imageLen: imageSrc?.length, width, height,
    })
    samController.signal.addEventListener('abort', () => {
      console.log(`[drawer ${effectId}] abort signal fired`)
    })

    const tryLocalExtractor = async (externalBodyMask) => {
      const guide = await extractGuideMaskFromImage(
        imageSrc, width, height,
        externalBodyMask ? { externalBodyMask } : {},
      )
      if (cancelled) return false
      if (guide && guide.edges.length > 0 && guide.centroids.length >= 3) {
        maskRef.current = guide
        guideRef.current = {
          centroids: guide.centroids,
          edges: guide.edges,
          endpoints: guide.endpoints,
        }
        setGuideDebug(guide.debug)
        setMaskMode(externalBodyMask ? 'sam' : 'skeleton')
        setSkeletonSegments(guide.segments || [])
        return true
      }
      return false
    }

    // Vision-LLM path: the model returns centerline segments directly
    // (no mask-to-skeleton round-trip). Used by Claude and Gemini.
    // Feeds the drawer's skeletonSegments state and marks the guide mode
    // with the provider id so the status line reflects which one ran.
    const tryVisionLLM = async (providerId, fn, labelForStatus) => {
      setSamLoading(true)
      setSamCurrentModel(labelForStatus)
      setSamProgress({ idx: 1, total: 1 })
      try {
        const out = await fn(imageSrc, width, height, { signal: samController.signal })
        if (cancelled) return false
        if (out && out.segments && out.segments.length > 0) {
          // The provider gave us segments directly; we don't have a
          // centroids/edges graph to snap strokes against, so guideRef
          // stays null (no snap-on-release), but the dashed guide +
          // letter-dotted.svg come from these.
          maskRef.current = null
          guideRef.current = null
          setGuideDebug({
            dotCount: out.segments.reduce((a, s) => a + (s.points?.length || 0), 0),
            centroids: [], edges: [],
          })
          setMaskMode(providerId)
          setSkeletonSegments(out.segments)
          return true
        }
        return false
      } catch (err) {
        if (err?.name === 'AbortError') return 'aborted'
        if (err?.rateLimited) setSamRateLimited(true)
        else if (err?.insufficientCredit) setSamInsufficientCredit(true)
        else if (err?.overloaded) setSamOverloaded(true)
        else setSamError(err?.message || String(err))
        console.warn(`[drawer] ${providerId} segmenter failed:`, err)
        return false
      } finally {
        if (!cancelled) setSamLoading(false)
      }
    }

    const run = async () => {
      console.log(`[drawer ${effectId}] run starts`, {
        aiProvider, SAM_AVAILABLE, CLAUDE_AVAILABLE, GEMINI_AVAILABLE,
      })

      // Vision-LLM providers — centerline coords direct from the model.
      if (aiProvider === 'claude' && CLAUDE_AVAILABLE) {
        const r = await tryVisionLLM('claude', getSegmentsViaClaude, 'claude (vision)')
        if (r === 'aborted') return
        if (r === true) return
      }
      if (aiProvider === 'gemini' && GEMINI_AVAILABLE) {
        const r = await tryVisionLLM('gemini', getSegmentsViaGemini, 'gemini (vision)')
        if (r === 'aborted') return
        if (r === true) return
      }

      if (aiProvider === 'sam' && SAM_AVAILABLE) {
        // List of Replicate slugs to try in order. First hit wins; any
        // failure (402, 429, 404, 5xx, invalid mask) skips to the next
        // until the list is exhausted. This lets the user pre-fill a
        // priority list (paid → community → another community) so any
        // single model being down doesn't kill the flow.
        const modelsToTry = (Array.isArray(samModels) && samModels.length > 0)
          ? samModels
          : [SAM_MODEL_PRESETS[0].id]

        console.log(`[drawer] trying ${modelsToTry.length} SAM model(s) in order:`, modelsToTry)
        setSamLoading(true)
        let lastErr = null
        for (let i = 0; i < modelsToTry.length; i++) {
          const model = modelsToTry[i]
          setSamCurrentModel(model)
          setSamProgress({ idx: i + 1, total: modelsToTry.length })
          console.log(`[drawer] SAM attempt ${i + 1}/${modelsToTry.length}: ${model}`)

          try {
            const sam = await getLetterBodyMask(imageSrc, width, height, {
              signal: samController.signal,
              model,
            })
            if (cancelled) return
            if (sam && sam.mask) {
              if (await tryLocalExtractor(sam.mask)) {
                console.log(`[drawer] SAM succeeded with ${model}`)
                setSamLoading(false)
                return
              }
              console.info(`[drawer] ${model} returned mask but extractor produced no polyline`)
            } else {
              console.info(`[drawer] ${model} returned no mask`)
            }
            lastErr = new Error(`${model}: no usable mask`)
          } catch (err) {
            if (err?.name === 'AbortError') {
              console.log('[drawer] SAM fetch aborted')
              return
            }
            lastErr = err
            const reason = err?.insufficientCredit ? '402 insufficient credit'
              : err?.rateLimited ? '429 rate limited'
              : (err?.message || String(err))
            console.info(`[drawer] ${model} failed → ${reason}`)
          }

          if (i < modelsToTry.length - 1) {
            console.info(`[drawer] trying next model: ${modelsToTry[i + 1]}`)
          }
        }

        // Exhausted all models — surface whichever error was last.
        console.warn(`[drawer] all ${modelsToTry.length} SAM model(s) exhausted; using local extractor`)
        if (!cancelled && lastErr) {
          if (lastErr.rateLimited) setSamRateLimited(true)
          else if (lastErr.insufficientCredit) setSamInsufficientCredit(true)
          else setSamError(lastErr.message || String(lastErr))
        }
        if (!cancelled) setSamLoading(false)
      }

      try {
        if (await tryLocalExtractor(null)) return
      } catch (_) { /* fall through */ }

      try {
        const mask = await buildMaskFromImage(imageSrc, width, height)
        if (cancelled) return
        maskRef.current = mask
        setMaskMode('fallback')
      } catch (_) {
        if (!cancelled) { maskRef.current = null; setMaskMode('none') }
      }
    }

    // StrictMode debounce: delay the actual work ~80ms. If React's simulated
    // unmount fires within that window (always does, in microseconds), the
    // timer is cancelled before doing any network I/O. The real mount fires
    // the setTimeout cleanly after the debounce window.
    const debounceId = setTimeout(run, 80)

    return () => {
      console.log(`[drawer ${effectId}] effect cleanup`)
      cancelled = true
      clearTimeout(debounceId)
      samController.abort()
    }
  }, [imageSrc, width, height])

  // ---- Coordinate conversion ------------------------------------------------
  const toLetterCoords = useCallback((clientX, clientY) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left) / SCALE,
      y: (clientY - rect.top) / SCALE,
    }
  }, [SCALE])

  // ---- Drawing handlers -----------------------------------------------------
  // Input stabilization:
  //   SMOOTH_ALPHA: weight applied to the raw pointer (0–1). Lower = more smoothing.
  //   Centerline pull is applied by snapToCenterline via the letter's distance
  //   field, so the correction is always radial toward the skeleton and never
  //   depends on the (noisy) travel direction.
  const SMOOTH_ALPHA = 0.5

  const startStroke = useCallback((clientX, clientY) => {
    const raw = toLetterCoords(clientX, clientY)
    if (!raw) return
    setIsDrawing(true)
    setCurrentStroke([raw])
  }, [toLetterCoords])

  const continueStroke = useCallback((clientX, clientY) => {
    if (!isDrawing) {
      const raw = toLetterCoords(clientX, clientY)
      if (raw) setCursorPos(raw)
      return
    }
    const raw = toLetterCoords(clientX, clientY)
    if (!raw) return
    setCursorPos(raw)
    setCurrentStroke(prev => {
      const last = prev[prev.length - 1]
      if (!last) return [raw]

      // EMA input smoothing toward the raw pointer — removes hand jitter.
      // No guide snap here: the stroke follows the cursor freely during
      // motion; the snap to the dotted-guide polyline runs in endStroke.
      const smoothX = last.x + (raw.x - last.x) * SMOOTH_ALPHA
      const smoothY = last.y + (raw.y - last.y) * SMOOTH_ALPHA

      if (Math.hypot(smoothX - last.x, smoothY - last.y) < 1.2) return prev
      return [...prev, { x: smoothX, y: smoothY }]
    })
  }, [isDrawing, toLetterCoords])

  const endStroke = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)
    if (currentStroke.length >= 2) {
      const adjusted = adjustStrokeToGuide(currentStroke)
      setStrokes(prev => [...prev, adjusted])
    }
    setCurrentStroke([])
  }, [isDrawing, currentStroke, adjustStrokeToGuide])

  // ---- Mouse events ---------------------------------------------------------
  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    startStroke(e.clientX, e.clientY)
  }, [startStroke])

  const onMouseMove = useCallback((e) => {
    continueStroke(e.clientX, e.clientY)
  }, [continueStroke])

  const onMouseUp = useCallback(() => endStroke(), [endStroke])

  // ---- Touch events ---------------------------------------------------------
  const onTouchStart = useCallback((e) => {
    e.preventDefault()
    const t = e.touches[0]
    startStroke(t.clientX, t.clientY)
  }, [startStroke])

  const onTouchMove = useCallback((e) => {
    e.preventDefault()
    const t = e.touches[0]
    continueStroke(t.clientX, t.clientY)
  }, [continueStroke])

  const onTouchEnd = useCallback((e) => {
    e.preventDefault()
    endStroke()
  }, [endStroke])

  // ---- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      // N → force new stroke
      if (e.key === 'n' || e.key === 'N') {
        if (isDrawing) endStroke()
      }
      // Ctrl+Z → undo last stroke
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        setStrokes(prev => prev.slice(0, -1))
      }
      // Enter → finalize
      if (e.key === 'Enter') {
        e.preventDefault()
        handleFinalize()
      }
      // Escape → clear all
      if (e.key === 'Escape') {
        setStrokes([])
        setCurrentStroke([])
        setIsDrawing(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDrawing, endStroke])

  // ---- Undo -----------------------------------------------------------------
  const undoLast = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1))
  }, [])

  // ---- Clear all ------------------------------------------------------------
  const clearAll = useCallback(() => {
    setStrokes([])
    setCurrentStroke([])
    setIsDrawing(false)
  }, [])

  // ---- Re-project all strokes onto the guide --------------------------------
  // Manually re-runs the same projection that endStroke does, in case the
  // user wants to redo the adjustment (e.g. after editing or if the initial
  // projection looked off). Falls back to the legacy centerline pull when
  // there's no polyline guide (raster-only case).
  const centerStrokes = useCallback(() => {
    let allStrokes = [...strokes]
    if (currentStroke.length >= 2) allStrokes.push(currentStroke)
    if (allStrokes.length === 0) return

    const g = guideRef.current
    const hasPolyline = g && g.edges && g.edges.length > 0
    const centered = allStrokes.map(s => hasPolyline
      ? projectStrokeOnGuide(s, g)
      : centerStrokePoints(s, maskRef.current))
    setStrokes(centered)
    setCurrentStroke([])
    setIsDrawing(false)
  }, [strokes, currentStroke])

  // ---- Finalize → resample & emit dotList -----------------------------------
  const handleFinalize = useCallback(() => {
    if (strokes.length === 0 && currentStroke.length < 2) return

    // If still drawing, commit current stroke first
    let allStrokes = [...strokes]
    if (currentStroke.length >= 2) allStrokes.push(currentStroke)

    const dotList = allStrokes.map(rawPts => {
      const resampled = resample(rawPts, dotCount)
      const coordinates = resampled.map(p => ({
        coords: [parseFloat(p.x.toFixed(3)), parseFloat(p.y.toFixed(3))]
      }))
      // Mark corners
      for (let i = 1; i < coordinates.length - 1; i++) {
        const prev = coordinates[i - 1].coords
        const curr = coordinates[i].coords
        const next = coordinates[i + 1].coords
        const a1 = Math.atan2(curr[1] - prev[1], curr[0] - prev[0])
        const a2 = Math.atan2(next[1] - curr[1], next[0] - curr[0])
        let diff = Math.abs(a2 - a1)
        if (diff > Math.PI) diff = 2 * Math.PI - diff
        if (diff > Math.PI / 4) coordinates[i].corner = true
      }

      const dragger = [
        parseFloat(resampled[0].x.toFixed(0)),
        parseFloat(resampled[0].y.toFixed(0)),
      ]
      return { dragger, coordinates }
    })

    // Per-user-stroke SVG path strings. Points are kept so the generator can
    // match each user stroke to the closest skeleton segment when it builds
    // letter-dotted.svg.
    const strokePaths = allStrokes.map((pts, i) => {
      const smoothed = smooth(pts, 2)
      let d = `M${smoothed[0].x.toFixed(2)},${smoothed[0].y.toFixed(2)}`
      for (let j = 1; j < smoothed.length; j++) {
        d += `L${smoothed[j].x.toFixed(2)},${smoothed[j].y.toFixed(2)}`
      }
      return { id: `path${i + 1}`, d, points: smoothed }
    })

    // Skeleton segments are the same across the lifetime of this PNG — pass
    // them along so the generator can use them as the dashed letter-dotted.svg
    // paths.
    const skeletonPaths = (skeletonSegments || []).map((seg, i) => ({
      id: `path${i + 1}`,
      d: seg.d,
      points: seg.points,
    }))

    onComplete?.({ dotList, strokePaths, skeletonPaths })
  }, [strokes, currentStroke, dotCount, onComplete, skeletonSegments])

  // ---- Rendering ------------------------------------------------------------
  const allVisibleStrokes = [...strokes]
  if (currentStroke.length >= 2) allVisibleStrokes.push(currentStroke)

  return (
    <div className="manual-drawer">
      {/* Header */}
      <div className="manual-drawer-header">
        <span className="manual-letter-label">{displayLetter}</span>
        <span className="manual-stroke-count">{strokes.length} trazo{strokes.length !== 1 ? 's' : ''}</span>
        <div className="manual-actions">
          <button className="btn btn-sm" onClick={undoLast} disabled={strokes.length === 0}>
            Deshacer (Ctrl+Z)
          </button>
          <button className="btn btn-sm" onClick={clearAll} disabled={strokes.length === 0 && currentStroke.length === 0}>
            Limpiar (Esc)
          </button>
          <button
            className="btn btn-sm"
            onClick={centerStrokes}
            disabled={(strokes.length === 0 && currentStroke.length < 2) || !imageSrc}
            title={!imageSrc
              ? 'Requiere cargar una imagen de referencia en el paso 1'
              : 'Suaviza temblores y centra el trazado en el cuerpo de la letra'}
          >
            Centrar trazado
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleFinalize}
            disabled={strokes.length === 0 && currentStroke.length < 2}
          >
            Guardar (Enter)
          </button>
          {guideDebug && (
            <button
              className="btn btn-sm"
              onClick={() => setShowGuideDebug(v => !v)}
              title="Muestra los puntos guía detectados en el SVG"
            >
              {showGuideDebug ? 'Ocultar guía' : 'Ver guía'}
            </button>
          )}
          {onCancel && (
            <button className="btn btn-sm btn-secondary" onClick={onCancel}>Cancelar</button>
          )}
        </div>
      </div>

      {/* Shortcuts legend */}
      <div className="manual-shortcuts">
        <span><kbd>Click + arrastrar</kbd> dibuja un trazo</span>
        <span><kbd>Soltar</kbd> termina el trazo</span>
        <span><kbd>N</kbd> forzar fin de trazo</span>
        <span><kbd>Ctrl+Z</kbd> deshacer</span>
        <span><kbd>Enter</kbd> guardar</span>
        <span><kbd>Esc</kbd> limpiar</span>
        {samLoading && (
          <span style={{ color: '#1565c0' }}>
            Segmentando con <code style={{ fontSize: '0.85em' }}>{samCurrentModel || 'SAM'}</code>
            {samProgress.total > 1 ? ` (${samProgress.idx}/${samProgress.total})` : ''}…
          </span>
        )}
        {samRateLimited && !samLoading && (
          <span style={{ color: '#b26a00' }} title="Replicate rate-limita el plan gratuito a ~6 req/min. Añade un método de pago o espera 10-15s entre cargas.">
            SAM rate-limited — usando extractor local
          </span>
        )}
        {samOverloaded && !samLoading && (
          <span style={{ color: '#b26a00' }}>
            Proveedor saturado (503) tras reintentos — intenta de nuevo en unos minutos o cambia de proveedor. Usando extractor local mientras tanto.
          </span>
        )}
        {samInsufficientCredit && !samLoading && (
          <span style={{ color: '#b26a00' }}>
            SAM requiere crédito (meta/sam-2 no es gratis) — usando extractor local.{' '}
            <a
              href="https://replicate.com/account/billing"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1565c0', textDecoration: 'underline' }}
            >
              Añadir crédito en Replicate
            </a>
          </span>
        )}
        {samError && !samLoading && (
          <span
            style={{ color: '#b71c1c', maxWidth: 600, wordBreak: 'break-word' }}
            title={samError}
          >
            SAM error → extractor local. Detalle: {samError.length > 140 ? samError.slice(0, 140) + '…' : samError}
          </span>
        )}
        {maskMode === 'sam' && (
          <span style={{ color: '#1565c0' }}>
            Ajuste al soltar: esqueleto SAM 2 ({guideDebug?.dotCount} puntos)
          </span>
        )}
        {maskMode === 'claude' && (
          <span style={{ color: '#7c3aed' }}>
            Guía generada por Claude (vision) — dibuja sin snap
          </span>
        )}
        {maskMode === 'gemini' && (
          <span style={{ color: '#1a73e8' }}>
            Guía generada por Gemini (vision) — dibuja sin snap
          </span>
        )}
        {maskMode === 'skeleton' && (
          <span style={{ color: '#2e7d32' }}>
            Ajuste al soltar: esqueleto del cuerpo de la letra ({guideDebug?.dotCount} puntos)
          </span>
        )}
        {maskMode === 'fallback' && (
          <span style={{ color: '#e65100' }}>
            Ajuste al soltar: centrado por imagen (cuerpo blanco no detectado)
          </span>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="manual-canvas"
        style={{
          width: width * SCALE,
          height: height * SCALE,
          position: 'relative',
          margin: '0 auto',
          cursor: isDrawing ? 'crosshair' : 'crosshair',
          overflow: 'hidden',
          background: '#fafafa',
          borderRadius: 12,
          boxSizing: 'content-box',
          border: `2px solid ${isDrawing ? '#f04e23' : '#ccc'}`,
          transition: 'border-color 0.2s',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
          width, height,
          position: 'relative',
        }}>
          {/* Reference image guide — the user draws over this */}
          {imageSrc && (
            <img
              src={imageSrc}
              alt=""
              draggable={false}
              style={{
                position: 'absolute', inset: 0, zIndex: 1,
                width: '100%', height: '100%',
                objectFit: 'contain',
                opacity: 0.4,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          )}

          {/* SVG overlay: drawn strokes */}
          <svg
            style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}
            viewBox={`0 0 ${width} ${height}`}
          >
            {/* Dashed tracing guide — rendered from the skeleton segments of
                the letter body. Same visual style that will be exported as
                letter-dotted.svg, so "what you see here is what you get". */}
            {skeletonSegments.length > 0 && (
              <g opacity="0.85">
                {skeletonSegments.map((seg, i) => (
                  <path
                    key={`guide-${i}`}
                    d={seg.d}
                    fill="none"
                    stroke="#ccc"
                    strokeWidth={dottedStrokeWidth}
                    strokeDasharray={`${dottedDash},${dottedGap}`}
                    strokeLinecap="round"
                  />
                ))}
              </g>
            )}

            {/* Completed strokes */}
            {strokes.map((stroke, si) => (
              <g key={si}>
                <polyline
                  points={stroke.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#f04e23" strokeWidth="6"
                  strokeLinecap="round" strokeLinejoin="round" opacity="0.7"
                />
                {/* Start marker */}
                <circle cx={stroke[0].x} cy={stroke[0].y} r="5"
                  fill="#2196F3" stroke="#fff" strokeWidth="1.5"
                />
                {/* End marker */}
                <circle cx={stroke[stroke.length-1].x} cy={stroke[stroke.length-1].y} r="5"
                  fill="#4caf50" stroke="#fff" strokeWidth="1.5"
                />
                {/* Stroke number */}
                <text x={stroke[0].x + 8} y={stroke[0].y - 8}
                  fontSize="11" fontWeight="bold" fill="#2196F3"
                >
                  {si + 1}
                </text>
              </g>
            ))}

            {/* Current stroke being drawn */}
            {currentStroke.length >= 2 && (
              <g>
                <polyline
                  points={currentStroke.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#f04e23" strokeWidth="6"
                  strokeLinecap="round" strokeLinejoin="round"
                />
                <circle cx={currentStroke[0].x} cy={currentStroke[0].y} r="5"
                  fill="#2196F3" stroke="#fff" strokeWidth="1.5"
                />
              </g>
            )}

            {/* Debug: detected guide polyline — edges the snap projects onto */}
            {showGuideDebug && guideDebug && guideDebug.edges && (
              <g opacity="0.75">
                {guideDebug.edges.map((e, i) => {
                  const A = guideDebug.centroids[e.a]
                  const B = guideDebug.centroids[e.b]
                  if (!A || !B) return null
                  return (
                    <line key={`eg-${i}`}
                      x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                      stroke="#00bcd4" strokeWidth="1.5"
                    />
                  )
                })}
                {guideDebug.centroids.map((c, i) => {
                  const isEndpoint = guideDebug.endpoints?.includes(i)
                  return (
                    <circle key={`dbg-${i}`} cx={c.x} cy={c.y}
                      r={isEndpoint ? 4 : 2}
                      fill={isEndpoint ? '#ff6f00' : '#006064'}
                      stroke={isEndpoint ? '#fff' : 'none'}
                      strokeWidth={isEndpoint ? 1 : 0}
                    />
                  )
                })}
              </g>
            )}

            {/* Cursor crosshair */}
            {cursorPos && (
              <g opacity="0.4">
                <line x1={cursorPos.x - 8} y1={cursorPos.y} x2={cursorPos.x + 8} y2={cursorPos.y}
                  stroke="#333" strokeWidth="1" />
                <line x1={cursorPos.x} y1={cursorPos.y - 8} x2={cursorPos.x} y2={cursorPos.y + 8}
                  stroke="#333" strokeWidth="1" />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Stroke list */}
      {strokes.length > 0 && (
        <div className="manual-stroke-list">
          {strokes.map((stroke, i) => (
            <div key={i} className="manual-stroke-item">
              <span className="manual-stroke-num">{i + 1}</span>
              <span className="manual-stroke-info">
                {stroke.length} pts — inicio ({stroke[0].x.toFixed(0)}, {stroke[0].y.toFixed(0)})
                → fin ({stroke[stroke.length-1].x.toFixed(0)}, {stroke[stroke.length-1].y.toFixed(0)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// =============================================================================
// Helpers — resample & smooth (same logic as pathSampler.js)
// =============================================================================

function resample(points, n) {
  if (points.length <= 1 || n <= 1) return points
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y))
  }
  const total = lengths[lengths.length - 1]
  if (total === 0) return [points[0]]

  const step = total / (n - 1)
  const out = [{ x: points[0].x, y: points[0].y }]
  let pi = 1
  for (let i = 1; i < n - 1; i++) {
    const target = i * step
    while (pi < points.length - 1 && lengths[pi] < target) pi++
    const s = lengths[pi - 1], e = lengths[pi]
    const t = e > s ? (target - s) / (e - s) : 0
    out.push({
      x: points[pi-1].x + t * (points[pi].x - points[pi-1].x),
      y: points[pi-1].y + t * (points[pi].y - points[pi-1].y),
    })
  }
  out.push({ x: points[points.length-1].x, y: points[points.length-1].y })
  return out
}

function smooth(points, iterations = 2) {
  let pts = points.map(p => ({ ...p }))
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
