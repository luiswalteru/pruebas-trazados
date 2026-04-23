import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export default function PreviewPage() {
  const navigate = useNavigate()

  const [previewData, setPreviewData] = useState(null)
  const [stepIdx, setStepIdx] = useState(0)        // current stroke index
  const [dotIdx, setDotIdx] = useState(0)           // next dot to hit
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [tracedPath, setTracedPath] = useState([])  // dots already hit this stroke
  const [completedStrokes, setCompletedStrokes] = useState([]) // paths from earlier strokes
  const [phase, setPhase] = useState('idle')        // idle | ready | tracing | done
  const [showFill, setShowFill] = useState(false)
  const [debugMode, setDebugMode] = useState(true)

  const containerRef = useRef(null)

  // ---- Load data ----------------------------------------------------------
  useEffect(() => {
    if (window.__trazadoPreview) {
      setPreviewData(window.__trazadoPreview)
      setPhase('ready')
    }
  }, [])

  const handleFileUpload = useCallback(async (e) => {
    const files = e.target.files
    if (!files?.length) return
    const data = {}
    for (const file of files) {
      const text = await file.text()
      if (file.name === 'data.json') data.dataJson = JSON.parse(text)
      else if (file.name === 'base.svg') data.baseSvg = text
      else if (file.name === 'bg.svg') data.bgSvg = text
      else if (file.name === 'dotted.svg') data.dottedSvg = text
    }
    if (data.dataJson) { setPreviewData(data); resetAll() }
  }, [])

  // ---- Helpers ------------------------------------------------------------
  const resetAll = useCallback(() => {
    setStepIdx(0)
    setDotIdx(0)
    setTracedPath([])
    setCompletedStrokes([])
    setShowFill(false)
    setPhase('ready')
  }, [])

  const currentDotList = previewData?.dataJson?.dotList?.[stepIdx] ?? null
  const totalSteps = previewData?.dataJson?.dotList?.length ?? 0
  const dotSize = previewData?.dataJson?.dotSize ?? 33
  const letterW = previewData?.dataJson?.letterSize?.[0] ?? 380
  const letterH = previewData?.dataJson?.letterSize?.[1] ?? 340
  const SCALE = 1.4

  // ---- Coordinate conversion (screen px → letter-space) -------------------
  // Container is content-box with a 2 px border, so getBoundingClientRect
  // returns the border-box. Subtract clientLeft/clientTop (the border widths)
  // so a click on the top-left pixel of the visible drawing surface maps to
  // letter-space (0, 0). Matches the same correction in ManualPathDrawer.
  const screenToLetter = useCallback((clientX, clientY) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const x = (clientX - rect.left - el.clientLeft) / SCALE
    const y = (clientY - rect.top - el.clientTop) / SCALE
    return { x, y }
  }, [SCALE])

  // ---- Mouse / touch handling  (NO need to hold button down) --------------
  const handlePointerMove = useCallback((clientX, clientY) => {
    const pos = screenToLetter(clientX, clientY)
    setMousePos(pos)

    if (phase !== 'tracing' || !currentDotList) return
    const coords = currentDotList.coordinates
    if (dotIdx >= coords.length) return

    const target = coords[dotIdx]
    const tx = Number(target.coords[0])
    const ty = Number(target.coords[1])
    const dx = pos.x - tx
    const dy = pos.y - ty

    // Generous hit radius: max(dotSize, 28) so small dotSizes still work
    const hitRadius = Math.max(dotSize, 28)
    if (dx * dx + dy * dy < hitRadius * hitRadius) {
      // Hit!
      setTracedPath(prev => [...prev, { x: tx, y: ty }])

      const nextDot = dotIdx + 1
      if (nextDot >= coords.length) {
        // Stroke finished — move to next or complete
        const archived = [...tracedPath, { x: tx, y: ty }]
        setCompletedStrokes(prev => [...prev, archived])

        if (stepIdx + 1 >= totalSteps) {
          setPhase('done')
          setTimeout(() => setShowFill(true), 300)
        } else {
          setStepIdx(s => s + 1)
          setDotIdx(0)
          setTracedPath([])
        }
      } else {
        setDotIdx(nextDot)
      }
    }
  }, [phase, currentDotList, dotIdx, dotSize, screenToLetter, stepIdx, totalSteps, tracedPath])

  const onMouseMove = useCallback((e) => {
    handlePointerMove(e.clientX, e.clientY)
  }, [handlePointerMove])

  const onMouseDown = useCallback(() => {
    if (phase === 'ready') setPhase('tracing')
  }, [phase])

  const onTouchMove = useCallback((e) => {
    e.preventDefault()
    const t = e.touches[0]
    if (phase === 'ready') setPhase('tracing')
    handlePointerMove(t.clientX, t.clientY)
  }, [phase, handlePointerMove])

  const onTouchStart = useCallback((e) => {
    e.preventDefault()
    if (phase === 'ready') setPhase('tracing')
    const t = e.touches[0]
    handlePointerMove(t.clientX, t.clientY)
  }, [phase, handlePointerMove])

  const handleGoBack = useCallback(() => navigate('/generator?step=4'), [navigate])

  // ---- Empty state --------------------------------------------------------
  if (!previewData) {
    return (
      <div className="preview-page">
        <h2>Preview de Trazado</h2>
        <button className="btn btn-secondary" onClick={handleGoBack} style={{ marginBottom: 16 }}>
          ← Volver al Generador
        </button>
        <div className="preview-upload">
          <p>Carga los archivos de un trazado generado para previsualizarlo, o genera uno desde el Generador.</p>
          <label className="btn btn-primary">
            Cargar archivos de trazado
            <input type="file" multiple accept=".json,.svg" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
          <p className="info-text">Selecciona data.json, base.svg y opcionalmente bg.svg + dotted.svg</p>
        </div>
      </div>
    )
  }

  // ---- Render -------------------------------------------------------------
  const { dataJson, bgSvg, dottedSvg } = previewData
  const dots = currentDotList?.coordinates ?? []

  return (
    <div className="preview-page">
      {/* Header */}
      <div className="preview-header">
        <h2>Preview: {dataJson.title?.es || 'Trazado'}</h2>
        <div className="preview-controls">
          <button className="btn btn-secondary" onClick={handleGoBack}>← Volver</button>
          <button className="btn btn-secondary" onClick={resetAll}>Reiniciar</button>
          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={debugMode} onChange={e => setDebugMode(e.target.checked)} />
            Debug
          </label>
          <span className="phase-badge">{phase}</span>
          {totalSteps > 1 && (
            <span className="step-info">Trazo {stepIdx + 1} de {totalSteps}</span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="preview-canvas"
        style={{
          width: letterW * SCALE,
          height: letterH * SCALE,
          position: 'relative',
          margin: '0 auto',
          cursor: phase === 'tracing' ? 'none' : 'pointer',
          overflow: 'hidden',
          background: '#f5f5f5',
          borderRadius: 12,
          boxSizing: 'content-box',   // avoid border messing with sizes
          border: '2px solid #ddd',
        }}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
      >
        {/* Scaled inner layer — all children use letter-space coordinates */}
        <div style={{
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
          width: letterW,
          height: letterH,
          position: 'relative',
        }}>

          {/* Background layer (bg.svg) — shown under everything */}
          {bgSvg && (
            bgSvg.startsWith('data:') || bgSvg.startsWith('http')
              ? <img src={bgSvg} alt="" className="preview-layer"
                  style={{ position: 'absolute', inset: 0, zIndex: 1,
                           width: '100%', height: '100%', objectFit: 'contain',
                           pointerEvents: 'none' }}
                />
              : <div className="preview-layer"
                  style={{ position: 'absolute', inset: 0, zIndex: 1 }}
                  dangerouslySetInnerHTML={{ __html: bgSvg }}
                />
          )}

          {/* Dotted guide (dotted.svg) — overlaid on bg */}
          {dottedSvg && (
            dottedSvg.startsWith('data:') || dottedSvg.startsWith('http')
              ? <img src={dottedSvg} alt="" className="preview-layer"
                  style={{ position: 'absolute', inset: 0, zIndex: 2,
                           width: '100%', height: '100%', objectFit: 'contain',
                           pointerEvents: 'none' }}
                />
              : <div className="preview-layer"
                  style={{ position: 'absolute', inset: 0, zIndex: 2 }}
                  dangerouslySetInnerHTML={{ __html: dottedSvg }}
                />
          )}

          {/* SVG overlay for traced paths + dots */}
          {!showFill && (
            <svg
              style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}
              viewBox={`0 0 ${letterW} ${letterH}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Previously completed strokes */}
              {completedStrokes.map((stroke, si) => (
                <polyline
                  key={`done-${si}`}
                  points={stroke.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#4caf50" strokeWidth="6"
                  strokeLinecap="round" strokeLinejoin="round" opacity="0.6"
                />
              ))}

              {/* Current stroke progress */}
              {tracedPath.length > 1 && (
                <polyline
                  points={tracedPath.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#f04e23" strokeWidth="8"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              )}

              {/* Dots for current stroke */}
              {dots.map((dot, idx) => {
                const cx = Number(dot.coords[0])
                const cy = Number(dot.coords[1])
                const isNext = idx === dotIdx
                const isPassed = idx < dotIdx

                if (!debugMode && !isNext && !isPassed) return null

                return (
                  <g key={idx}>
                    {/* Debug: show all dots as small circles */}
                    {debugMode && (
                      <circle cx={cx} cy={cy} r={isPassed ? 3 : isNext ? 6 : 4}
                        fill={isPassed ? '#4caf50' : isNext ? '#f04e23' : 'rgba(0,0,0,0.15)'}
                        stroke={isNext ? '#f04e23' : 'none'} strokeWidth={isNext ? 2 : 0}
                      />
                    )}
                    {/* Hit-area visualization for next dot */}
                    {isNext && (
                      <circle cx={cx} cy={cy} r={Math.max(dotSize, 28)}
                        fill="rgba(240,78,35,0.1)" stroke="#f04e23"
                        strokeWidth="1.5" strokeDasharray="4,3"
                      />
                    )}
                    {/* Index label in debug */}
                    {debugMode && (
                      <text x={cx + 6} y={cy - 6} fontSize="8" fill="#999">{idx}</text>
                    )}
                  </g>
                )
              })}
            </svg>
          )}

          {/* Start position indicator (pulsing blue dot) */}
          {phase === 'ready' && currentDotList && (
            <div className="start-dot blink" style={{
              position: 'absolute',
              left: Number(currentDotList.dragger[0]) - 12,
              top: Number(currentDotList.dragger[1]) - 12,
              width: 24, height: 24,
              borderRadius: '50%',
              background: '#2196F3',
              zIndex: 8,
              boxShadow: '0 0 12px rgba(33,150,243,0.5)',
            }} />
          )}

          {/* Dragger cursor */}
          {phase === 'tracing' && (
            <div className="dragger" style={{
              position: 'absolute',
              left: mousePos.x - 15,
              top: mousePos.y - 15,
              width: 30, height: 30,
              borderRadius: '50%',
              background: '#f04e23',
              zIndex: 10,
              pointerEvents: 'none',
              boxShadow: '0 0 10px rgba(240,78,35,0.5)',
            }} />
          )}
        </div>
      </div>

      {/* Info bar */}
      <div style={{
        textAlign: 'center', marginTop: 12, fontSize: '0.85rem', color: '#777'
      }}>
        {phase === 'ready' && 'Haz click para comenzar a trazar'}
        {phase === 'tracing' && `Dot ${dotIdx + 1} / ${dots.length}  —  Mueve el cursor por los puntos`}
        {phase === 'done' && 'Trazado completado'}
      </div>

      {/* Debug panel */}
      {debugMode && (
        <details className="debug-panel" open>
          <summary>Depuración</summary>
          <div className="debug-content">
            <p>Phase: <b>{phase}</b> | Step: {stepIdx + 1}/{totalSteps} | Dot: {dotIdx}/{dots.length}</p>
            <p>Mouse (letter-space): ({mousePos.x.toFixed(1)}, {mousePos.y.toFixed(1)})</p>
            {dotIdx < dots.length && (
              <p>Target dot: ({Number(dots[dotIdx].coords[0]).toFixed(1)}, {Number(dots[dotIdx].coords[1]).toFixed(1)})
                {' '}— dist: {Math.hypot(mousePos.x - Number(dots[dotIdx].coords[0]), mousePos.y - Number(dots[dotIdx].coords[1])).toFixed(1)}px
                {' '}— hitRadius: {Math.max(dotSize, 28)}
              </p>
            )}
            <p>Canvas: {letterW}×{letterH} | Scale: {SCALE} | DotSize: {dotSize}</p>
            <pre style={{ maxHeight: 150, overflow: 'auto', fontSize: 10 }}>
              {JSON.stringify(dataJson?.dotList?.map((dl, i) => ({
                stroke: i + 1,
                points: dl.coordinates.length,
                dragger: dl.dragger,
                firstDot: dl.coordinates[0]?.coords,
                lastDot: dl.coordinates[dl.coordinates.length - 1]?.coords,
              })), null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  )
}
