import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { parseFont, glyphToSvgPathData } from '../utils/fontParser'
import {
  generateFillSvg,
  generateOutlineSvg,
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

  // Restore step from URL param (?step=4) or persisted state, default 1
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

  // Manual drawing state
  const [manualDrawings, setManualDrawings] = useState(_persisted.manualDrawings || {})  // { letter: { dotList, strokePaths } }
  // The active letter in the drawer is always the single selected letter (only
  // one at a time is allowed), so we derive it from selectedLetters[0].
  const activeLetter = selectedLetters[0] || null
  // Optional reference font for manual mode (shows letter shape as guide)
  const [refFont, setRefFont] = useState(_persisted.refFont || null)
  const [refFontName, setRefFontName] = useState(_persisted.refFontName || '')
  const refFontInputRef = useRef(null)

  // Persist state on every change so it survives navigation
  useEffect(() => {
    window.__generatorState = {
      type, selectedLetters, generatedTrazados,
      currentStep, dotCount, dotSize, canvasWidth, canvasHeight, strokeWidth,
      manualDrawings, refFont, refFontName
    }
  })

  // Letter selection — only one letter at a time
  const toggleLetter = useCallback((letter) => {
    setSelectedLetters(prev => (prev[0] === letter ? [] : [letter]))
  }, [])

  // Reference font for manual mode
  const handleRefFontUpload = useCallback(async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseFont(buffer)
      setRefFont(parsed)
      setRefFontName(file.name)
    } catch (err) {
      alert('Error al cargar fuente de referencia: ' + err.message)
    }
  }, [])

  // Get reference SVGs for a letter (used as guide in manual mode)
  const getRefSvgs = useCallback((letter) => {
    if (!refFont) return { fillSvg: '', outlineSvg: '', fillPathD: '' }
    const char = type === 'mayusculas' ? letter.toUpperCase() : letter.toLowerCase()
    try {
      const gd = glyphToSvgPathData(refFont, char, canvasWidth, canvasHeight)
      return {
        fillSvg: generateFillSvg(gd.d, canvasWidth, canvasHeight),
        outlineSvg: generateOutlineSvg(gd.d, canvasWidth, canvasHeight, 3),
        fillPathD: gd.d,
      }
    } catch { return { fillSvg: '', outlineSvg: '', fillPathD: '' } }
  }, [refFont, type, canvasWidth, canvasHeight])

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
    const refSvgs = getRefSvgs(letter)

    // Letter-fill.svg: use reference font glyph when available, otherwise
    // fall back to the thickened user strokes so the shape is non-empty.
    const fillStrokeWidth = Math.max(20, effDotSize * 1.2)
    const fillSvg = refSvgs.fillSvg
      || generateFillSvgFromStrokes(strokePaths, w, h, fillStrokeWidth)

    // Letter-outline.svg: outline of the glyph or outlined user strokes
    const outlineSvg = refSvgs.outlineSvg
      || generateOutlineSvgFromStrokes(strokePaths, w, h, 3)

    // Letter-dotted.svg: dashed path per stroke (historical format)
    // stroke-width mirrors animationPathStroke so the dotted look matches the
    // on-screen animation weight.
    const dottedSvg = generateDottedSvg(strokePaths, w, h, effStroke)

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
      fillPathD: refSvgs.fillPathD,
    }
  }, [type, manualDrawings, getRefSvgs, canvasWidth, canvasHeight, dotSize, strokeWidth])

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
    setCurrentStep(4)
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
    // Store in sessionStorage for preview page (using JSON for complex data)
    const previewData = {
      dataJson: trazado.dataJson,
      fillSvg: trazado.fillSvg,
      outlineSvg: trazado.outlineSvg,
      dottedSvg: trazado.dottedSvg,
    }
    window.__trazadoPreview = previewData
    navigate('/preview')
  }, [generatedTrazados, navigate])

  return (
    <div className="generator-page">
      {/* Steps indicator */}
      <div className="steps-bar">
        {[
          { n: 1, label: 'Inicio' },
          { n: 2, label: 'Letras' },
          { n: 3, label: 'Generar' },
          { n: 4, label: 'Assets & Exportar' },
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

      {/* Step 1: Manual mode intro & optional reference font */}
      {currentStep === 1 && (
        <div className="step-content">
          <h2>Paso 1: Trazado manual</h2>

          <div className="svg-mode-info">
            <p>Dibujarás el recorrido de cada trazado con el cursor en el paso 3.</p>
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: 12 }}>
              Opcionalmente, carga una fuente como referencia visual para ver la forma de las letras mientras dibujas.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                ref={refFontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                onChange={handleRefFontUpload}
                style={{ display: 'none' }}
              />
              <button className="btn btn-secondary" onClick={() => refFontInputRef.current?.click()}>
                {refFontName ? `Referencia: ${refFontName}` : 'Cargar fuente de referencia (opcional)'}
              </button>
              <button className="btn btn-primary" onClick={() => setCurrentStep(2)}>
                Siguiente →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Type and letter selection */}
      {currentStep === 2 && (
        <div className="step-content">
          <h2>Paso 2: Seleccionar tipo y letras</h2>

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
              {selectedLetters[0]
                ? `Letra seleccionada: ${type === 'mayusculas' ? selectedLetters[0].toUpperCase() : selectedLetters[0]}`
                : 'Ninguna letra seleccionada'}
            </span>
          </div>

          <div className="letter-grid">
            {ALL_LETTERS.map(letter => (
              <button
                key={letter}
                className={`letter-btn ${selectedLetters.includes(letter) ? 'selected' : ''}`}
                onClick={() => toggleLetter(letter)}
              >
                <span className="letter-display">
                  {type === 'mayusculas' ? letter.toUpperCase() : letter}
                </span>
                <small className="letter-name">{letter}</small>
              </button>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>← Anterior</button>
            <button
              className="btn btn-primary"
              onClick={() => setCurrentStep(3)}
              disabled={selectedLetters.length === 0}
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Configure & Generate */}
      {currentStep === 3 && (
        <div className="step-content">
          <h2>Paso 3: Configurar y generar</h2>

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
          </div>

          {/* -------- Manual drawing interface -------- */}
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
                Haz click y arrastra para cada trazo. Suelta el mouse para terminar un trazo
                y haz click de nuevo para empezar otro.
              </p>

              <ManualPathDrawer
                key={activeLetter}
                letter={activeLetter}
                type={type}
                fillSvg={getRefSvgs(activeLetter).fillSvg}
                outlineSvg={getRefSvgs(activeLetter).outlineSvg}
                width={canvasWidth}
                height={canvasHeight}
                dotCount={dotCount}
                dotSize={dotSize}
                onComplete={(result) => handleManualComplete(activeLetter, result)}
              />
            </div>
          )}

          <div className="generate-actions">
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>← Anterior</button>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleGenerate}
              disabled={generating || selectedLetters.length === 0 || Object.keys(manualDrawings).length === 0}
            >
              {generating ? 'Generando...' : `Generar ${selectedLetters.length} trazado(s)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Assets & Export */}
      {currentStep === 4 && (
        <div className="step-content">
          <h2>Paso 4: Assets y exportación</h2>

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

                {/* Show computed values per letter */}
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
            <button className="btn btn-secondary" onClick={() => setCurrentStep(3)}>← Anterior</button>
          </div>
        </div>
      )}
    </div>
  )
}
