import { useState, useRef, useCallback, useEffect } from 'react'
import { buildMaskFromImage, centerStrokePoints } from '../utils/letterMask'
import {
  extractGuideMaskFromImage,
  isSvgSource,
  projectStrokeOnGuide,
} from '../utils/guideExtractor'

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
  onComplete,
  onCancel,
}) {
  const SCALE = 1.4
  const containerRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState([])           // finished strokes: Array<Array<{x,y}>>
  const [currentStroke, setCurrentStroke] = useState([]) // points of the stroke being drawn
  const [cursorPos, setCursorPos] = useState(null)
  const maskRef = useRef(null)                         // rasterized letter mask for center-snapping
  const guideRef = useRef(null)                        // { centroids, edges } for polyline snap
  // Debug state for the SVG guide extractor — lets us see which blobs were
  // classified as guide dots so thresholds can be tuned if the segmentation
  // misses or over-picks.
  const [guideDebug, setGuideDebug] = useState(null)   // { dotCount, centroids, edges } | null
  const [showGuideDebug, setShowGuideDebug] = useState(false)
  const [maskMode, setMaskMode] = useState('none')     // 'svg-dots' | 'fallback' | 'none'

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

  // Build the mask when the reference image changes so drawn points can snap
  // to the centerline. For SVG inputs (full-scene illustrations with a
  // character) we extract just the dotted-guide blobs; for raster inputs or
  // when extraction fails we fall back to the raw dark-pixel mask.
  useEffect(() => {
    let cancelled = false
    maskRef.current = null
    guideRef.current = null
    setGuideDebug(null)
    setMaskMode('none')
    if (!imageSrc) return

    const run = async () => {
      if (isSvgSource(imageSrc)) {
        try {
          const guide = await extractGuideMaskFromImage(imageSrc, width, height)
          if (cancelled) return
          if (guide && guide.debug.dotCount >= 3 && guide.edges.length > 0) {
            maskRef.current = guide
            guideRef.current = { centroids: guide.centroids, edges: guide.edges }
            setGuideDebug(guide.debug)
            setMaskMode('svg-dots')
            return
          }
        } catch (_) { /* fall through to raster fallback */ }
      }
      try {
        const mask = await buildMaskFromImage(imageSrc, width, height)
        if (cancelled) return
        maskRef.current = mask
        setMaskMode('fallback')
      } catch (_) {
        if (!cancelled) { maskRef.current = null; setMaskMode('none') }
      }
    }
    run()

    return () => { cancelled = true }
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

    // Also build SVG path strings for the dotted SVG
    const strokePaths = allStrokes.map((pts, i) => {
      const smoothed = smooth(pts, 2)
      let d = `M${smoothed[0].x.toFixed(2)},${smoothed[0].y.toFixed(2)}`
      for (let j = 1; j < smoothed.length; j++) {
        d += `L${smoothed[j].x.toFixed(2)},${smoothed[j].y.toFixed(2)}`
      }
      return { id: `path${i + 1}`, d }
    })

    onComplete?.({ dotList, strokePaths })
  }, [strokes, currentStroke, dotCount, onComplete])

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
        {maskMode === 'svg-dots' && (
          <span style={{ color: '#2e7d32' }}>
            Ajuste al soltar: guía SVG ({guideDebug?.dotCount} puntos)
          </span>
        )}
        {maskMode === 'fallback' && (
          <span style={{ color: '#e65100' }}>
            Ajuste al soltar: centrado por imagen
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
