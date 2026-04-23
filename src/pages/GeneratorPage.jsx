import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { generateBaseSvg } from '../utils/svgGenerator'
import { generateDataJson, getFolderName, SPANISH_LETTERS, SPECIAL_COMBOS, computeLetterParams } from '../utils/dataGenerator'
import { downloadSingleTrazado, exportAllTrazados, writeTrazadoToReader } from '../utils/exportUtils'
import ManualPathDrawer from '../components/ManualPathDrawer'

const ALL_LETTERS = [...SPANISH_LETTERS, ...SPECIAL_COMBOS]

/**
 * Parse intrinsic width/height from an SVG data URL. The uploaded SVGs dictate
 * the letter-space coordinate system: `base.svg`'s viewBox must match
 * `bg.svg`'s (and by extension `dotted.svg`'s) so the reader can stack all
 * three layers without misalignment. Looks at the `width`/`height` attributes
 * first, falls back to `viewBox`. Returns `null` if nothing parseable.
 */
function parseSvgDims(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  try {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    const header = dataUrl.slice(0, comma)
    const body = dataUrl.slice(comma + 1)
    const text = header.includes(';base64')
      ? atob(body)
      : decodeURIComponent(body)
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (!svg) return null
    // Attributes may carry unit suffixes ("380px"); parseFloat strips them.
    const w = parseFloat(svg.getAttribute('width'))
    const h = parseFloat(svg.getAttribute('height'))
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) }
    }
    const vb = svg.getAttribute('viewBox')
    if (vb) {
      const parts = vb.split(/\s+|,/).map(Number)
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { width: Math.round(parts[2]), height: Math.round(parts[3]) }
      }
    }
    return null
  } catch {
    return null
  }
}

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

  // Manual drawing state
  const [manualDrawings, setManualDrawings] = useState(_persisted.manualDrawings || {})  // { letter: { dotList, strokePaths } }
  // The active letter in the drawer is always the single selected letter (only
  // one at a time is allowed), so we derive it from selectedLetters[0].
  const activeLetter = selectedLetters[0] || null

  // Per-letter reference SVGs: { [letter]: { bg: dataURL, dotted: dataURL } }.
  // bg.svg is the background illustration, dotted.svg is the dashed tracing
  // guide rendered on top. Both are required before the user can advance to
  // Step 2.
  const [images, setImages] = useState(_persisted.images || {})
  const bgInputRef = useRef(null)
  const dottedInputRef = useRef(null)
  const activeImages = activeLetter ? (images[activeLetter] || {}) : {}
  const activeBg = activeImages.bg || ''
  const activeDotted = activeImages.dotted || ''

  // Persist state on every change so it survives navigation
  useEffect(() => {
    window.__generatorState = {
      type, selectedLetters, generatedTrazados,
      currentStep, dotCount, dotSize, canvasWidth, canvasHeight, strokeWidth,
      manualDrawings, images,
    }
  })

  // Letter selection — only one letter at a time
  const toggleLetter = useCallback((letter) => {
    setSelectedLetters(prev => (prev[0] === letter ? [] : [letter]))
  }, [])

  // Reference SVG upload for the active letter. `kind` is 'bg' or 'dotted' —
  // both must be set before the user can advance to Step 2. The dotted SVG is
  // used as the snap skeleton by the drawer.
  //
  // We do NOT auto-override canvasWidth/canvasHeight from the uploaded SVG's
  // intrinsic dimensions, because the canvas dims feed `computeLetterParams`
  // (which sets dotSize / animationPathStroke) and drive the drawer's display
  // size — silently changing them resized the drawing area and the stroke
  // thickness. Instead we warn in the console when the canvas and the SVG's
  // viewBox differ, so the user can reconcile them manually if the reader
  // needs matching viewBoxes for stacking. The `base.svg` viewBox stays
  // aligned with `data.json.letterSize`, which is the canonical letter-space.
  const handleSvgUpload = useCallback((kind) => (e) => {
    const file = e.target.files[0]
    if (!file || !activeLetter) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      setImages(prev => ({
        ...prev,
        [activeLetter]: { ...(prev[activeLetter] || {}), [kind]: dataUrl },
      }))
      const dims = parseSvgDims(dataUrl)
      if (dims && (dims.width !== canvasWidth || dims.height !== canvasHeight)) {
        console.warn(
          `[GeneratorPage] ${kind}.svg mide ${dims.width}×${dims.height}, ` +
          `canvas actual ${canvasWidth}×${canvasHeight}. Si los viewBox deben coincidir ` +
          `para el reader, ajusta canvas manualmente en el paso 2.`,
        )
      }
    }
    reader.onerror = () => alert('Error al leer el SVG')
    reader.readAsDataURL(file)
    // Reset input so uploading the same file again re-triggers onChange
    e.target.value = ''
  }, [activeLetter, canvasWidth, canvasHeight])

  const clearSvg = useCallback((kind) => () => {
    if (!activeLetter) return
    setImages(prev => {
      const curr = prev[activeLetter] || {}
      const nextForLetter = { ...curr }
      delete nextForLetter[kind]
      const next = { ...prev }
      if (Object.keys(nextForLetter).length === 0) delete next[activeLetter]
      else next[activeLetter] = nextForLetter
      return next
    })
  }, [activeLetter])

  // Manual drawing complete for the active letter
  const handleManualComplete = useCallback((letter, result) => {
    setManualDrawings(prev => ({ ...prev, [letter]: result }))
  }, [])

  // Generate trazado for a single letter from the manual drawing. The bundle
  // is now just data.json + base.svg — letter-fill/outline/dotted.svg and
  // thum.png are no longer produced (bg.svg and dotted.svg are uploaded
  // directly in Step 1 and, for this flow, only used as drawing guides).
  const generateForLetter = useCallback((letter) => {
    const manual = manualDrawings[letter]
    if (!manual) {
      throw new Error('No hay trazado manual dibujado para esta letra')
    }

    const w = canvasWidth
    const h = canvasHeight

    // Compute dynamic dotSize & animationPathStroke. User-provided values > 0
    // take precedence; 0 falls back to the auto-computed recommendation.
    const letterParams = computeLetterParams(letter, type, w)
    const effDotSize = (dotSize > 0) ? dotSize : letterParams.dotSize
    const effStroke  = (strokeWidth > 0) ? strokeWidth : letterParams.animationPathStroke

    const dotList = manual.dotList
    const strokePaths = manual.strokePaths || []

    const animationPaths = strokePaths.map((p, i) => ({
      length: dotList[i]?.coordinates?.length || 40,
      time: Math.max(2, Math.round((dotList[i]?.coordinates?.length || 40) / 4))
    }))

    // base.svg mirrors the letters.js React components: letterBg rect,
    // one <path id="pathN" class="svgPath" stroke-width="effStroke"> per user
    // stroke, circle at the first point. Stroke width is baked in from
    // animationPathStroke so the file is self-contained.
    const baseSvg = generateBaseSvg(strokePaths, w, h, effStroke)

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
      baseSvg,
      dataJson,
      dotList,
      strokePaths,
    }
  }, [type, manualDrawings, canvasWidth, canvasHeight, dotSize, strokeWidth])

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

  // Preview single. The preview uses the uploaded bg.svg + dotted.svg as the
  // visual backdrop (since we no longer generate letter-fill/outline/dotted)
  // and `base.svg` for the animated stroke path.
  const handlePreview = useCallback((letter) => {
    const trazado = generatedTrazados[letter]
    if (!trazado || trazado.error) return
    const uploaded = images[letter] || {}
    const previewData = {
      dataJson: trazado.dataJson,
      baseSvg: trazado.baseSvg,
      bgSvg: uploaded.bg || '',
      dottedSvg: uploaded.dotted || '',
    }
    window.__trazadoPreview = previewData
    navigate('/preview')
  }, [generatedTrazados, images, navigate])

  // "Preview en reader": write the 5 files into public/reader/libro/assets/
  // trazados/{type}/{folderName}/ via the dev-server middleware, then open
  // the reader URL in a new tab. Only works under `npm run dev` — the
  // middleware isn't available in a production build.
  const [readerBusy, setReaderBusy] = useState(null) // letter being written, or null
  const handlePreviewInReader = useCallback(async (letter) => {
    const trazado = generatedTrazados[letter]
    if (!trazado || trazado.error) return
    setReaderBusy(letter)
    try {
      await writeTrazadoToReader(trazado, type)
      const url =
        `/reader/index.html?package=libro&manifest=imsmanifest.xml&core_exercise=edelvives_primaria` +
        `#/trazados/${type}/${trazado.folderName}`
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      alert(`No se pudo copiar al reader: ${err.message}\n\n` +
            `Verifica que la app corre en "npm run dev" (el middleware no existe en build de producción).`)
    } finally {
      setReaderBusy(null)
    }
  }, [generatedTrazados, type])

  const canAdvanceFromStep1 = !!activeLetter && !!activeBg && !!activeDotted
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
            {ALL_LETTERS.map(letter => {
              const imgs = images[letter] || {}
              const ready = !!imgs.bg && !!imgs.dotted
              return (
                <button
                  key={letter}
                  className={`letter-btn ${selectedLetters.includes(letter) ? 'selected' : ''} ${ready ? 'has-image' : ''}`}
                  onClick={() => toggleLetter(letter)}
                  title={ready ? 'bg.svg y dotted.svg cargados' : (imgs.bg || imgs.dotted ? 'Falta uno de los dos SVG' : '')}
                >
                  <span className="letter-display">
                    {type === 'mayusculas' ? letter.toUpperCase() : letter}
                  </span>
                  <small className="letter-name">{letter}{ready ? ' ✓' : ''}</small>
                </button>
              )
            })}
          </div>

          {/* Two-SVG upload panel for the selected letter */}
          <div className="image-upload-panel" style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
            <h3 style={{ marginBottom: 12, fontSize: '1rem' }}>
              Imágenes de referencia (bg.svg + dotted.svg)
              {activeLetter && (
                <span style={{ color: '#f04e23', marginLeft: 8 }}>
                  — letra {type === 'mayusculas' ? activeLetter.toUpperCase() : activeLetter}
                </span>
              )}
            </h3>

            {!activeLetter && (
              <p style={{ color: '#888', fontSize: '0.9rem' }}>
                Selecciona primero una letra para poder cargar sus SVG.
              </p>
            )}

            {activeLetter && (
              <>
                <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 12 }}>
                  Carga dos archivos SVG por letra: <b>bg.svg</b> (la base que
                  se ve detrás) y <b>dotted.svg</b> (la línea punteada que
                  indica por dónde debe pasar el trazo). El dotted.svg se
                  utiliza además como esqueleto para ajustar los trazos al
                  soltar el cursor.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[
                    { key: 'bg', label: 'bg.svg (base)', value: activeBg, ref: bgInputRef },
                    { key: 'dotted', label: 'dotted.svg (guía)', value: activeDotted, ref: dottedInputRef },
                  ].map(slot => (
                    <div key={slot.key} style={{
                      padding: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 6,
                    }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>
                        {slot.label} {slot.value && <span style={{ color: '#2e7d32' }}>✓</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <input
                          ref={slot.ref}
                          type="file"
                          accept=".svg,image/svg+xml"
                          onChange={handleSvgUpload(slot.key)}
                          style={{ display: 'none' }}
                        />
                        <button className="btn btn-sm btn-secondary" onClick={() => slot.ref.current?.click()}>
                          {slot.value ? 'Reemplazar' : 'Cargar'}
                        </button>
                        {slot.value && (
                          <button className="btn btn-sm" onClick={clearSvg(slot.key)}>Quitar</button>
                        )}
                        {slot.value && (
                          <div style={{
                            width: 110, height: 90,
                            background: '#fafafa',
                            border: '1px solid #eee',
                            borderRadius: 4,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden',
                          }}>
                            <img
                              src={slot.value}
                              alt=""
                              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {activeBg && activeDotted && (
                  <div style={{
                    marginTop: 12, padding: 10, background: '#fff',
                    border: '1px solid #ddd', borderRadius: 6,
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 6 }}>Vista previa apilada:</div>
                    <div style={{
                      position: 'relative', width: 200, height: 170,
                      background: '#fafafa', border: '1px solid #eee', borderRadius: 4,
                      margin: '0 auto', overflow: 'hidden',
                    }}>
                      <img src={activeBg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
                      <img src={activeDotted} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  </div>
                )}
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
                Haz click y arrastra para cada trazo siguiendo la línea punteada.
                Dibuja con libertad: al soltar el mouse el trazo se ajusta
                automáticamente sobre la guía. Haz click de nuevo para empezar
                otro trazo. El orden define la secuencia de los trazados.
              </p>

              <ManualPathDrawer
                key={activeLetter}
                letter={activeLetter}
                type={type}
                bgSvg={activeBg}
                dottedSvg={activeDotted}
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
                      <button
                        className="btn btn-sm"
                        onClick={() => handlePreviewInReader(letter)}
                        disabled={readerBusy === letter}
                        title="Copia los archivos al reader local y abre la url en una nueva pestaña"
                      >
                        {readerBusy === letter ? 'Copiando...' : 'Preview en reader'}
                      </button>
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
