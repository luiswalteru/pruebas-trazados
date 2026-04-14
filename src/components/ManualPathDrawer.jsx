import { useState, useRef, useCallback, useEffect } from 'react'
import { buildLetterMask, snapToCenterline, centerStrokePoints } from '../utils/letterMask'

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
 *   fillSvg       – optional SVG string to show as filled guide
 *   outlineSvg    – optional SVG string to show as outline guide
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
  fillSvg = '',
  outlineSvg = '',
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

  const displayLetter = type === 'mayusculas' ? letter.toUpperCase() : letter.toLowerCase()

  // Build the letter mask when fillSvg changes so drawn points can be snapped
  // to the centerline of the letter.
  useEffect(() => {
    let cancelled = false
    maskRef.current = null
    if (!fillSvg) return
    buildLetterMask(fillSvg, width, height)
      .then(mask => { if (!cancelled) maskRef.current = mask })
      .catch(() => { maskRef.current = null })
    return () => { cancelled = true }
  }, [fillSvg, width, height])

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
    const snapped = snapToCenterline(raw, maskRef.current)
    setIsDrawing(true)
    setCurrentStroke([snapped])
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
      if (!last) return [snapToCenterline(raw, maskRef.current)]

      // EMA input smoothing toward the raw pointer — removes hand jitter
      const smoothX = last.x + (raw.x - last.x) * SMOOTH_ALPHA
      const smoothY = last.y + (raw.y - last.y) * SMOOTH_ALPHA

      // Skip tiny movements so we don't overfit to cursor jitter
      if (Math.hypot(smoothX - last.x, smoothY - last.y) < 1.2) return prev

      // Pull the smoothed point toward the letter's medial axis using the
      // precomputed distance-field gradient (radial, always stable).
      const snapped = snapToCenterline({ x: smoothX, y: smoothY }, maskRef.current)
      return [...prev, snapped]
    })
  }, [isDrawing, toLetterCoords])

  const endStroke = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)
    if (currentStroke.length >= 2) {
      setStrokes(prev => [...prev, currentStroke])
    }
    setCurrentStroke([])
  }, [isDrawing, currentStroke])

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

  // ---- Center finished strokes on the letter body ---------------------------
  // Runs after the user has drawn all strokes. Applies a heavy post-process
  // pass (smooth → iterative snap-to-centerline → smooth) to remove tremor
  // and pull each stroke onto the letter's medial axis. Replaces `strokes`
  // in place so the result is visible on the canvas before saving.
  const centerStrokes = useCallback(() => {
    // Commit any in-progress stroke first so it's included.
    let allStrokes = [...strokes]
    if (currentStroke.length >= 2) allStrokes.push(currentStroke)
    if (allStrokes.length === 0) return

    const centered = allStrokes.map(s => centerStrokePoints(s, maskRef.current))
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
            disabled={(strokes.length === 0 && currentStroke.length < 2) || !fillSvg}
            title={!fillSvg
              ? 'Requiere cargar una fuente de referencia en el paso 1'
              : 'Suaviza temblores y centra el trazado en el cuerpo de la letra'}
          >
            Centrar trazado
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleFinalize}
            disabled={strokes.length === 0 && currentStroke.length < 2}
          >
            Guardar (Enter)
          </button>
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
        {fillSvg && <span style={{ color: '#2e7d32' }}>Auto-centrado activo</span>}
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
          {/* Letter fill guide (very faint) */}
          {fillSvg && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, opacity: 0.08 }}
              dangerouslySetInnerHTML={{ __html: fillSvg }}
            />
          )}

          {/* Letter outline guide */}
          {outlineSvg && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, opacity: 0.2 }}
              dangerouslySetInnerHTML={{ __html: outlineSvg }}
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
