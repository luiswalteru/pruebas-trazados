import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  generateDottedSvg,
  generateFillSvgFromStrokes,
  generateOutlineSvgFromStrokes,
} from '../utils/svgGenerator'
import { generateDataJson, getFolderName, SPANISH_LETTERS, SPECIAL_COMBOS, computeLetterParams } from '../utils/dataGenerator'
import { downloadSingleTrazado, exportAllTrazados, writeTrazadoToReader } from '../utils/exportUtils'
import ManualPathDrawer from '../components/ManualPathDrawer'
import { SAM_MODEL_PRESETS, SAM_AVAILABLE } from '../utils/samSegmenter'
import { CLAUDE_AVAILABLE } from '../utils/claudeSegmenter'
import { GEMINI_AVAILABLE } from '../utils/geminiSegmenter'

const ALL_LETTERS = [...SPANISH_LETTERS, ...SPECIAL_COMBOS]

/**
 * Align the skeleton segments (auto-extracted from the PNG) to the user's
 * stroke drawing order. The downstream `letter-dotted.svg` uses selectors
 * `#path1`, `#path2`, ... and the data.json `letterAnimationPath` entries
 * reference those same selectors by index, so both must stay in sync.
 *
 * Strategy:
 *   • For each user stroke, find the best-matching unused skeleton segment
 *     by end-to-end distance (trying both orientations, keeping the minimum).
 *   • If the user drew more strokes than the skeleton has segments, the
 *     unmatched ones fall back to the user's own drawn path — avoids leaving
 *     a stroke without any dotted guide in the export.
 *   • Any leftover skeleton segments are appended at the end (unlikely to be
 *     referenced by animations but still emitted so the guide is visually
 *     complete if the player falls back to the raw dotted SVG).
 */
function alignSkeletonToStrokes(skeletonPaths, strokePaths) {
  if (!skeletonPaths || skeletonPaths.length === 0) return strokePaths
  if (!strokePaths || strokePaths.length === 0) {
    return skeletonPaths.map((p, i) => ({ id: `path${i + 1}`, d: p.d }))
  }
  const used = new Array(skeletonPaths.length).fill(false)
  const result = []
  for (let i = 0; i < strokePaths.length; i++) {
    const us = strokePaths[i]
    const usPts = us.points || []
    const usFirst = usPts[0]
    const usLast = usPts[usPts.length - 1]
    let bestIdx = -1
    let bestScore = Infinity
    if (usFirst && usLast) {
      for (let j = 0; j < skeletonPaths.length; j++) {
        if (used[j]) continue
        const sk = skeletonPaths[j]
        const skFirst = sk.points?.[0]
        const skLast = sk.points?.[sk.points.length - 1]
        if (!skFirst || !skLast) continue
        const s1 = dist(usFirst, skFirst) + dist(usLast, skLast)
        const s2 = dist(usFirst, skLast) + dist(usLast, skFirst)
        const s = Math.min(s1, s2)
        if (s < bestScore) { bestScore = s; bestIdx = j }
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true
      result.push({ id: `path${result.length + 1}`, d: skeletonPaths[bestIdx].d })
    } else {
      result.push({ id: `path${result.length + 1}`, d: us.d })
    }
  }
  for (let j = 0; j < skeletonPaths.length; j++) {
    if (!used[j]) result.push({ id: `path${result.length + 1}`, d: skeletonPaths[j].d })
  }
  return result
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }

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

  // Priority-ordered list of Replicate model slugs the drawer tries for
  // SAM segmentation (first success wins). Persisted across navigations.
  const [samModels, setSamModels] = useState(
    _persisted.samModels || SAM_MODEL_PRESETS.map(p => p.id),
  )
  const [samCustomSlug, setSamCustomSlug] = useState(_persisted.samCustomSlug || '')
  // AI provider: 'sam' (Replicate SAM), 'claude' (Anthropic vision), 'none'.
  // Defaults to the first available provider, or 'none' if nothing configured.
  const [aiProvider, setAiProvider] = useState(
    _persisted.aiProvider || (
      GEMINI_AVAILABLE ? 'gemini' :   // free tier — safest default
      SAM_AVAILABLE ? 'sam' :
      CLAUDE_AVAILABLE ? 'claude' :
      'none'
    ),
  )

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
      samModels, samCustomSlug, aiProvider,
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
    const skeletonPaths = manual.skeletonPaths || []

    // letter-fill.svg and letter-outline.svg: both approximations rebuilt
    // from the user's drawn strokes. The uploaded PNG is a raster reference
    // only — it never becomes part of the exported bundle.
    const fillStrokeWidth = Math.max(20, effDotSize * 1.2)
    const fillSvg = generateFillSvgFromStrokes(strokePaths, w, h, fillStrokeWidth)
    const outlineSvg = generateOutlineSvgFromStrokes(strokePaths, w, h, 3)

    // letter-dotted.svg: dashed paths taken from the skeleton of the uploaded
    // PNG (the centerline of the letter's thickness), reordered to line up
    // with the user's stroke drawing sequence so #path1/#path2/... selectors
    // match letterAnimationPath entries in data.json. Falls back to the raw
    // user strokes if the skeleton couldn't be extracted. stroke-linecap:round
    // turns the 7,11 dashes into 12-unit capsules with ~6-unit gaps, matching
    // the reference letter-dotted.svg's look.
    const dottedPaths = alignSkeletonToStrokes(skeletonPaths, strokePaths)
    const dottedSvg = generateDottedSvg(
      dottedPaths, w, h,
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
                  Carga la imagen PNG de referencia (cuerpo de la letra en
                  blanco sobre fondo de color, con flechas y número de orden
                  opcionales). Se detecta automáticamente el cuerpo blanco y
                  se obtiene su esqueleto para ajustar los trazos al soltar.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept=".png,image/png"
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

          <AiProviderSelector
            aiProvider={aiProvider}
            setAiProvider={setAiProvider}
          />

          {aiProvider === 'sam' && SAM_AVAILABLE && (
            <SamModelSelector
              samModels={samModels}
              setSamModels={setSamModels}
              samCustomSlug={samCustomSlug}
              setSamCustomSlug={setSamCustomSlug}
            />
          )}

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
                imageSrc={activeImage}
                width={canvasWidth}
                height={canvasHeight}
                dotCount={dotCount}
                dotSize={dotSize}
                dottedStrokeWidth={dottedStrokeWidth}
                dottedDash={dottedDash}
                dottedGap={dottedGap}
                samModels={samModels}
                aiProvider={aiProvider}
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

/**
 * Picker for the SAM model(s) the drawer uses. Order = priority: the drawer
 * tries slugs top-down and stops at the first success. Users can:
 *   • Toggle presets on/off.
 *   • Reorder with the ↑ / ↓ buttons.
 *   • Add a custom Replicate slug (e.g. "owner/name") that's appended to
 *     the list — useful when a new community SAM wrapper appears.
 */
function SamModelSelector({ samModels, setSamModels, samCustomSlug, setSamCustomSlug }) {
  const presetMap = new Map(SAM_MODEL_PRESETS.map(p => [p.id, p]))
  const customIds = samModels.filter(id => !presetMap.has(id))

  const toggle = (id) => {
    setSamModels(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const move = (id, delta) => {
    setSamModels(prev => {
      const i = prev.indexOf(id)
      if (i < 0) return prev
      const j = i + delta
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const removeCustom = (id) => setSamModels(prev => prev.filter(x => x !== id))
  const addCustom = () => {
    const slug = samCustomSlug.trim()
    if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) return
    if (samModels.includes(slug)) return
    setSamModels(prev => [...prev, slug])
    setSamCustomSlug('')
  }

  const orderedIds = samModels
  const disabledPresetIds = SAM_MODEL_PRESETS
    .map(p => p.id)
    .filter(id => !samModels.includes(id))

  return (
    <div style={{
      marginBottom: 24, padding: 16,
      background: '#f5f8fc', border: '1px solid #d5e3f2', borderRadius: 8,
    }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>
        Modelos SAM (prioridad de arriba a abajo)
      </h4>
      <p style={{ fontSize: '0.8rem', color: '#555', margin: '0 0 12px 0' }}>
        Al segmentar se prueba cada modelo en orden; si uno devuelve 402 /
        429 / error, pasa automáticamente al siguiente.
      </p>

      {orderedIds.length === 0 && (
        <p style={{ color: '#b26a00', fontSize: '0.85rem' }}>
          Lista vacía — SAM está deshabilitado; se usará el extractor local.
        </p>
      )}

      {orderedIds.map((id, idx) => {
        const preset = presetMap.get(id)
        return (
          <div key={id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', marginBottom: 4,
            background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4,
            fontSize: '0.85rem',
          }}>
            <span style={{
              minWidth: 20, color: '#888', fontFamily: 'monospace',
            }}>{idx + 1}.</span>
            <code style={{ flex: 1, fontSize: '0.8rem' }}>{id}</code>
            {preset && (
              <span style={{ fontSize: '0.75rem', color: preset.paid ? '#b26a00' : '#2e7d32' }}>
                {preset.cost}
              </span>
            )}
            <button
              type="button" className="btn btn-sm"
              disabled={idx === 0}
              onClick={() => move(id, -1)}
              title="Subir prioridad"
            >↑</button>
            <button
              type="button" className="btn btn-sm"
              disabled={idx === orderedIds.length - 1}
              onClick={() => move(id, +1)}
              title="Bajar prioridad"
            >↓</button>
            <button
              type="button" className="btn btn-sm"
              onClick={() => preset ? toggle(id) : removeCustom(id)}
              title={preset ? 'Quitar de la lista' : 'Eliminar custom'}
            >✕</button>
          </div>
        )
      })}

      {disabledPresetIds.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: '0.8rem', color: '#666', marginRight: 8 }}>Añadir preset:</span>
          {disabledPresetIds.map(id => (
            <button
              key={id}
              type="button" className="btn btn-sm"
              onClick={() => toggle(id)}
              style={{ marginRight: 6 }}
            >+ {id}</button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>Slug custom:</span>
        <input
          type="text"
          placeholder="owner/name"
          value={samCustomSlug}
          onChange={e => setSamCustomSlug(e.target.value)}
          style={{
            flex: 1, padding: '4px 8px',
            border: '1px solid #ccc', borderRadius: 4,
            fontFamily: 'monospace', fontSize: '0.85rem',
          }}
        />
        <button
          type="button" className="btn btn-sm btn-primary"
          onClick={addCustom}
          disabled={!/^[\w.-]+\/[\w.-]+$/.test(samCustomSlug.trim())}
        >Añadir</button>
      </div>
    </div>
  )
}

/**
 * Provider dropdown for the segmentation backend. Each option is only
 * selectable when its env-var-driven availability flag is true — otherwise
 * it's disabled and annotated with a hint so the user knows what to add
 * to `.env.local`.
 */
function AiProviderSelector({ aiProvider, setAiProvider }) {
  const options = [
    { id: 'gemini', label: 'Gemini (Google vision) — free tier', available: GEMINI_AVAILABLE, hint: 'Requiere GEMINI_API_KEY (gratis en aistudio.google.com/apikey)' },
    { id: 'sam', label: 'SAM (Replicate) — paga', available: SAM_AVAILABLE, hint: 'Requiere REPLICATE_API_TOKEN + crédito en replicate.com' },
    { id: 'claude', label: 'Claude (Anthropic vision) — paga', available: CLAUDE_AVAILABLE, hint: 'Requiere ANTHROPIC_API_KEY + crédito en console.anthropic.com' },
    { id: 'none', label: 'Solo extractor local (sin IA)', available: true },
  ]

  return (
    <div style={{
      marginBottom: 16, padding: 12,
      background: '#f0f4f9', border: '1px solid #cfd8e3', borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>
        Proveedor IA:
      </label>
      <select
        value={aiProvider}
        onChange={e => setAiProvider(e.target.value)}
        style={{
          padding: '6px 10px', borderRadius: 4,
          border: '1px solid #ccc', fontSize: '0.9rem',
        }}
      >
        {options.map(o => (
          <option key={o.id} value={o.id} disabled={!o.available}>
            {o.label}{!o.available ? ` — no configurado` : ''}
          </option>
        ))}
      </select>
      {(() => {
        const picked = options.find(o => o.id === aiProvider)
        if (!picked || picked.available) return null
        return (
          <span style={{ color: '#b26a00', fontSize: '0.8rem' }}>
            {picked.hint} en .env.local
          </span>
        )
      })()}
    </div>
  )
}
