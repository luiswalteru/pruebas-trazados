import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  generateDottedSvg,
  generateFillSvgFromStrokes,
  generateOutlineSvgFromStrokes,
} from '../utils/svgGenerator'
import { generateDataJson, getFolderName, SPANISH_LETTERS, SPECIAL_COMBOS, computeLetterParams } from '../utils/dataGenerator'
import { downloadSingleTrazado, exportAllTrazados } from '../utils/exportUtils'
import ManualPathDrawer from '../components/ManualPathDrawer'

const ALL_LETTERS = [...SPANISH_LETTERS, ...SPECIAL_COMBOS]

// Persist generator state across navigations so returning from Preview restores it
const _persisted = window.__generatorState || {}

export default function GeneratorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Restore step from URL param (?step=N) or persisted state, default 1
  const initialStep = Number(searchParams.get('step')) || _persisted.currentStep || 1

  // State
  const [type, setType] = useState(_persisted.type || 'ligada')
  const [selectedLetters, setSelectedLetters] = useState(_persisted.selectedLetters || [])
  const [generatedTrazados, setGeneratedTrazados] = useState(_persisted.generatedTrazados || {})
  const [generating, setGenerating] = useState(false)
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [dotCount, setDotCount] = useState(_persisted.dotCount ?? 0)
  const [dotSize, setDotSize] = useState(_persisted.dotSize ?? 0)
  const [canvasWidth, setCanvasWidth] = useState(_persisted.canvasWidth || 380)
  const [canvasHeight, setCanvasHeight] = useState(_persisted.canvasHeight || 340)
  const [strokeWidth, setStrokeWidth] = useState(_persisted.strokeWidth ?? 0)
  // letter-dotted.svg style controls (match the image's dotted-line look)
  const [dottedStrokeWidth, setDottedStrokeWidth] = useState(_persisted.dottedStrokeWidth ?? 5)
  const [dottedDash, setDottedDash] = useState(_persisted.dottedDash ?? 7)
  const [dottedGap, setDottedGap] = useState(_persisted.dottedGap ?? 11)

  // Manual drawing state
  const [manualDrawings, setManualDrawings] = useState(_persisted.manualDrawings || {})  // { letter: { dotList, strokePaths } }
  // The active letter in the drawer is always the single selected letter (only
  // one at a time is allowed), so we derive it from selectedLetters[0].
  const activeLetter = selectedLetters[0] || null

  // Per-letter reference images: { [letter]: dataURL }
  const [images, setImages] = useState(_persisted.images || {})
  const imageInputRef = useRef(null)
  const activeImage = activeLetter ? images[activeLetter] : ''

  // Persist state on every change so it survives navigation
  useEffect(() => {
    window.__generatorState = {
      type, selectedLetters, generatedTrazados,
      currentStep, dotCount, dotSize, canvasWidth, canvasHeight, strokeWidth,
      manualDrawings, images,
      dottedStrokeWidth, dottedDash, dottedGap,
    }
  })

  // Letter selection — only one letter at a time
  const toggleLetter = useCallback((letter) => {
    setSelectedLetters(prev => (prev[0] === letter ? [] : [letter]))
  }, [])

  // Reference image upload for the active letter
  const handleImageUpload = useCallback((e) => {
    const file = e.target.files[0]
    if (!file || !activeLetter) return
    const reader = new FileReader()
    reader.onload = () => {
      setImages(prev => ({ ...prev, [activeLetter]: reader.result }))
    }
    reader.onerror = () => alert('Error al leer la imagen')
    reader.readAsDataURL(file)
    // Reset input so uploading the same file again re-triggers onChange
    e.target.value = ''
  }, [activeLetter])

  const clearImage = useCallback(() => {
    if (!activeLetter) return
    setImages(prev => {
      const next = { ...prev }
      delete next[activeLetter]
      return next
    })
  }, [activeLetter])

  // Manual drawing complete for the active letter
  const handleManualComplete = useCallback((letter, result) => {
    setManualDrawings(prev => ({ ...prev, [letter]: result }))
  }, [])

  // Generate trazado for a single letter from the manual drawing
  const generateForLetter = useCallback((letter) => {
    const manual = manualDrawings[letter]
    if (!manual) {
      throw new Error('No hay trazado manual dibujado para esta letra')
    }

    const w = canvasWidth
    const h = canvasHeight

    // Compute dynamic dotSize & animationPathStroke
    // Use user-provided values if > 0, otherwise auto-compute
    const letterParams = computeLetterParams(letter, type, w)
    const effDotSize = (dotSize > 0) ? dotSize : letterParams.dotSize
    const effStroke  = (strokeWidth > 0) ? strokeWidth : letterParams.animationPathStroke

    const dotList = manual.dotList
    const strokePaths = manual.strokePaths || []

    // letter-fill.svg / letter-outline.svg: always stroke-based — the reference
    // image is raster-only and we don't vectorize it.
    const fillStrokeWidth = Math.max(20, effDotSize * 1.2)
    const fillSvg = generateFillSvgFromStrokes(strokePaths, w, h, fillStrokeWidth)
    const outlineSvg = generateOutlineSvgFromStrokes(strokePaths, w, h, 3)

    // Letter-dotted.svg: dashed path per stroke. Uses the user-configured
    // stroke-width and dasharray so the exported dotted line matches the
    // style of the reference image. With stroke-linecap:round, the visible
    // dash = dash + strokeWidth and the visible gap = gap − strokeWidth.
    const dottedSvg = generateDottedSvg(
      strokePaths, w, h,
      dottedStrokeWidth,
      `${dottedDash},${dottedGap}`,
    )

    const animationPaths = strokePaths.map((p, i) => ({
      length: dotList[i]?.coordinates?.length || 40,
      time: Math.max(2, Math.round((dotList[i]?.coordinates?.length || 40) / 4))
    }))

    const folderName = getFolderName(letter, type)
    const dataJson = generateDataJson({
      letter,
      type,
      letterSize: [w, h],
      dotList,
      animationPaths,
      animationPathStroke: effStroke,
      dotSize: effDotSize,
    })

    return {
      letter,
      folderName,
      fillSvg,
      outlineSvg,
      dottedSvg,
      dataJson,
      dotList,
      strokePaths,
    }
  }, [type, manualDrawings, canvasWidth, canvasHeight, dotSize, strokeWidth, dottedStrokeWidth, dottedDash, dottedGap])

  // Generate all selected
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    const results = {}

    for (const letter of selectedLetters) {
      try {
        results[letter] = generateForLetter(letter)
      } catch (err) {
        console.error(`Error generating ${letter}:`, err)
        results[letter] = { error: err.message, letter }
      }
    }

    setGeneratedTrazados(results)
    setGenerating(false)
    setCurrentStep(3)
  }, [selectedLetters, generateForLetter])

  // Export single
  const handleExportSingle = useCallback(async (letter) => {
    const trazado = generatedTrazados[letter]
    if (!trazado || trazado.error) return
    await downloadSingleTrazado(trazado)
  }, [generatedTrazados])

  // Export all
  const handleExportAll = useCallback(async () => {
    const trazadosList = Object.values(generatedTrazados).filter(t => !t.error)
    if (trazadosList.length === 0) return
    await exportAllTrazados(trazadosList, type)
  }, [generatedTrazados, type])

  // Preview single
  const handlePreview = useCallback((letter) => {
    const trazado = generatedTrazados[letter]
    if (!trazado || trazado.error) return
    const previewData = {
      dataJson: trazado.dataJson,
      fillSvg: trazado.fillSvg,
      outlineSvg: trazado.outlineSvg,
      dottedSvg: trazado.dottedSvg,
    }
    window.__trazadoPreview = previewData
    navigate('/preview')
  }, [generatedTrazados, navigate])

  const canAdvanceFromStep1 = !!activeLetter && !!activeImage
  const canGenerate = !generating
    && selectedLetters.length > 0
    && selectedLetters.every(l => manualDrawings[l])

  return (
    <div className="generator-page">
      {/* Steps indicator */}
      <div className="steps-bar">
        {[
          { n: 1, label: 'Imagen' },
          { n: 2, label: 'Trazado' },
          { n: 3, label: 'Exportar' },
        ].map(s => (
          <button
            key={s.n}
            className={`step-btn ${currentStep === s.n ? 'active' : ''} ${currentStep > s.n ? 'done' : ''}`}
            onClick={() => setCurrentStep(s.n)}
          >
            <span className="step-num">{s.n}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Step 1: type + letter + image */}
      {currentStep === 1 && (
        <div className="step-content">
          <h2>Paso 1: Tipo, letra e imagen</h2>

          <div className="type-selector">
            <button
              className={`type-btn ${type === 'ligada' ? 'active' : ''}`}
              onClick={() => setType('ligada')}
            >
              Ligada (minúsculas)
            </button>
            <button
              className={`type-btn ${type === 'mayusculas' ? 'active' : ''}`}
              onClick={() => setType('mayusculas')}
            >
              Mayúsculas
            </button>
          </div>

          <div className="letter-controls">
            <span className="letter-count">
              {activeLetter
                ? `Letra seleccionada: ${type === 'mayusculas' ? activeLetter.toUpperCase() : activeLetter}`
                : 'Ninguna letra seleccionada'}
            </span>
          </div>

          <div className="letter-grid">
            {ALL_LETTERS.map(letter => (
              <button
                key={letter}
                className={`letter-btn ${selectedLetters.includes(letter) ? 'selected' : ''} ${images[letter] ? 'has-image' : ''}`}
                onClick={() => toggleLetter(letter)}
                title={images[letter] ? 'Imagen cargada' : ''}
              >
                <span className="letter-display">
                  {type === 'mayusculas' ? letter.toUpperCase() : letter}
                </span>
                <small className="letter-name">{letter}{images[letter] ? ' ✓' : ''}</small>
              </button>
            ))}
          </div>

          {/* Image upload for the selected letter */}
          <div className="image-upload-panel" style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
            <h3 style={{ marginBottom: 12, fontSize: '1rem' }}>
              Imagen de referencia
              {activeLetter && (
                <span style={{ color: '#f04e23', marginLeft: 8 }}>
                  — letra {type === 'mayusculas' ? activeLetter.toUpperCase() : activeLetter}
                </span>
              )}
            </h3>

            {!activeLetter && (
              <p style={{ color: '#888', fontSize: '0.9rem' }}>
                Selecciona primero una letra para poder cargar su imagen.
              </p>
            )}

            {activeLetter && (
              <>
                <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 12 }}>
                  Carga el SVG (o PNG/JPG) con la letra y la línea punteada.
                  Si es SVG, se extraen automáticamente los puntos guía para
                  ajustar el trazo al centro de la línea.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                  <button className="btn btn-secondary" onClick={() => imageInputRef.current?.click()}>
                    {activeImage ? 'Reemplazar imagen' : 'Cargar imagen'}
                  </button>
                  {activeImage && (
                    <button className="btn btn-sm" onClick={clearImage}>Quitar imagen</button>
                  )}
                  {activeImage && (
                    <div style={{
                      width: 160, height: 140,
                      background: '#fff',
                      border: '1px solid #ddd',
                      borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}>
                      <img
                        src={activeImage}
                        alt=""
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="step-actions" style={{ marginTop: 24 }}>
            <button
              className="btn btn-primary"
              onClick={() => setCurrentStep(2)}
              disabled={!canAdvanceFromStep1}
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Configure & draw & generate */}
      {currentStep === 2 && (
        <div className="step-content">
          <h2>Paso 2: Dibujar trazado</h2>

          <div className="config-panel">
            <div className="config-group">
              <label>Ancho del canvas (px)</label>
              <input type="number" value={canvasWidth} onChange={e => setCanvasWidth(Number(e.target.value))} min={80} max={800} />
            </div>
            <div className="config-group">
              <label>Alto del canvas (px)</label>
              <input type="number" value={canvasHeight} onChange={e => setCanvasHeight(Number(e.target.value))} min={80} max={800} />
            </div>
            <div className="config-group">
              <label>Cantidad de puntos por trazo</label>
              <input type="number" value={dotCount} onChange={e => setDotCount(Number(e.target.value))} min={0} max={100} />
            </div>
            <div className="config-group">
              <label>Tamaño de punto (dotSize)</label>
              <input type="number" value={dotSize} onChange={e => setDotSize(Number(e.target.value))} min={0} max={80} />
            </div>
            <div className="config-group">
              <label>Grosor del trazo de animación</label>
              <input type="number" value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} min={0} max={30} />
            </div>
            <div className="config-group">
              <label>Punteado: grosor (px)</label>
              <input type="number" value={dottedStrokeWidth} onChange={e => setDottedStrokeWidth(Number(e.target.value))} min={1} max={40} />
            </div>
            <div className="config-group">
              <label>Punteado: longitud de dash</label>
              <input type="number" value={dottedDash} onChange={e => setDottedDash(Number(e.target.value))} min={0} max={80} step="0.1" />
            </div>
            <div className="config-group">
              <label>Punteado: longitud de gap</label>
              <input type="number" value={dottedGap} onChange={e => setDottedGap(Number(e.target.value))} min={0} max={80} step="0.1" />
            </div>
          </div>

          {activeLetter && (
            <div style={{ marginBottom: 24 }}>
              <h3>
                Dibujar trazado — letra{' '}
                <span style={{ color: '#f04e23' }}>
                  {type === 'mayusculas' ? activeLetter.toUpperCase() : activeLetter}
                </span>
                {manualDrawings[activeLetter] && ' ✓'}
              </h3>
              <p className="info-text">
                Haz click y arrastra para cada trazo, siguiendo la línea punteada de la imagen.
                Suelta el mouse para terminar un trazo y haz click de nuevo para empezar otro.
                El orden en que dibujes define la secuencia de los trazados.
              </p>

              <ManualPathDrawer
                key={activeLetter}
                letter={activeLetter}
                type={type}
                imageSrc={activeImage}
                width={canvasWidth}
                height={canvasHeight}
                dotCount={dotCount}
                dotSize={dotSize}
                onComplete={(result) => handleManualComplete(activeLetter, result)}
              />
            </div>
          )}

          <div className="generate-actions">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>← Anterior</button>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              {generating ? 'Generando...' : `Generar y continuar`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Export */}
      {currentStep === 3 && (
        <div className="step-content">
          <h2>Paso 3: Exportar</h2>

          <div className="generated-list">
            <div className="export-header">
              <h3>Trazados generados ({Object.keys(generatedTrazados).filter(k => !generatedTrazados[k].error).length})</h3>
              <button className="btn btn-primary" onClick={handleExportAll}>
                Exportar todos como ZIP
              </button>
            </div>

            {Object.entries(generatedTrazados).map(([letter, trazado]) => (
              <div key={letter} className={`generated-item ${trazado.error ? 'has-error' : ''}`}>
                <div className="generated-item-header">
                  <span className="generated-letter">
                    {type === 'mayusculas' ? letter.toUpperCase() : letter}
                  </span>
                  <span className="generated-folder">{trazado.folderName || letter}</span>
                  {trazado.error ? (
                    <span className="error-msg">{trazado.error}</span>
                  ) : (
                    <div className="generated-actions">
                      <button className="btn btn-sm" onClick={() => handlePreview(letter)}>Preview</button>
                      <button className="btn btn-sm" onClick={() => handleExportSingle(letter)}>Exportar</button>
                    </div>
                  )}
                </div>

                {!trazado.error && trazado.dataJson && (
                  <div style={{ fontSize: '0.75rem', color: '#888', padding: '4px 12px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>Canvas: {trazado.dataJson.letterSize?.[0]}×{trazado.dataJson.letterSize?.[1]}</span>
                    <span>dotSize: {trazado.dataJson.dotSize}</span>
                    <span>stroke: {trazado.dataJson.animationPathStroke}</span>
                    <span>trazos: {trazado.dataJson.dotList?.length}</span>
                    {trazado.dataJson.dotList?.map((dl, i) => (
                      <span key={i}>trazo {i+1}: {dl.coordinates?.length} pts</span>
                    ))}
                  </div>
                )}

              </div>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>← Anterior</button>
          </div>
        </div>
      )}
    </div>
  )
}
