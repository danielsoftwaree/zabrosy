import { useEffect, useRef, useState } from 'react'
import { Compass } from '@phosphor-icons/react/dist/csr/Compass'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Minus } from '@phosphor-icons/react/dist/csr/Minus'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { bottomLabels, type Cast, type Draft } from '../../shared/model'
import { lineLength, markLineLength } from './domain'
import { sectorToPng } from './export-png'

type Props = {
  casts: Cast[]
  draft: Draft | null
  hiddenCount?: number
  previewDirectionDeg?: number | null
  onDirectionChange?: (degrees: number) => void
  previewLineM?: number
  onAimChange?: (degrees: number, meters: number) => void
}

const marks = ['−60°', '−30°', '0°', '+30°', '+60°']
const angles = [-60, -30, 0, 30, 60]

export function SectorView({ casts, draft, hiddenCount = 0, previewDirectionDeg = null, onDirectionChange, previewLineM = 30, onAimChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 390, height: 844, dock: 260 })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [rangeOverride, setRangeOverride] = useState<number | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const dock = wrap?.closest('.survey-panel')?.querySelector('.survey-dock')
    if (!wrap) return
    const measure = () => setSize({
      width: Math.max(320, wrap.clientWidth),
      height: Math.max(400, wrap.clientHeight),
      dock: dock?.getBoundingClientRect().height ?? 260,
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    if (dock) observer.observe(dock)
    return () => observer.disconnect()
  }, [])

  const shown = casts.slice(-60)
  const fullCircle = [...shown.map((cast) => cast.directionDeg), draft?.directionDeg, previewDirectionDeg]
    .some((angle) => angle !== null && angle !== undefined && Math.abs(angle) > 85)
  const measured = shown.map(lineLength).filter((value): value is number => value !== null)
  const minimumRange = Math.max(20, Math.ceil(Math.max(previewLineM, draft?.plannedLineM ?? 0, ...measured, ...shown.map((cast) => cast.plannedLineM ?? 0)) / 10) * 10)
  const range = Math.max(minimumRange, rangeOverride ?? Math.max(60, minimumRange))
  const { width, height, dock } = size
  const ox = width / 2
  const oy = fullCircle ? Math.max(180, (height - dock + 140) / 2) : height - dock - 10
  const extent = fullCircle
    ? Math.max(110, Math.min(width * .43, (height - dock - 145) * .44))
    : Math.max(190, Math.min(520, oy - 145))
  const radius = (meters: number) => Math.min(extent, meters / range * extent)
  const polar = (angle: number, length: number) => ({
    x: ox + Math.sin(angle * Math.PI / 180) * length,
    y: oy - Math.cos(angle * Math.PI / 180) * length,
  })

  function chooseDirection(event: React.MouseEvent<SVGSVGElement>) {
    if (!onDirectionChange && !onAimChange) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * width - ox
    const y = oy - (event.clientY - rect.top) / rect.height * height
    if (!fullCircle && y < 0) return
    const angle = Math.round(Math.atan2(x, y) * 180 / Math.PI)
    const meters = Math.max(1, Math.min(180, Math.round(Math.hypot(x, y) / extent * range)))
    if (onAimChange) onAimChange(angle, meters)
    else onDirectionChange?.(angle)
  }

  async function downloadPng() {
    if (!svgRef.current || exporting) return
    setExporting(true)
    setExportError('')
    try {
      const png = await sectorToPng(svgRef.current)
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url
      link.download = `marker-sector-${new Date().toISOString().slice(0, 10)}.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setExportError(error instanceof Error ? error.message : 'PNG не создан.') }
    finally { setExporting(false) }
  }

  return <div className="survey-sector-wrap" ref={wrapRef}>
    <svg ref={svgRef} className="survey-sector" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Схема сектора. ${casts.length} забросов в текущем ориентире. Длины лески показаны только для полной подмотки.`} onClick={chooseDirection}>
      <rect x="0" y="0" width={width} height={height} className="sector-water" />
      <path d={`M 0 ${oy + 26} Q ${ox} ${oy + 5} ${width} ${oy + 26} L ${width} ${height} H 0 Z`} className="sector-land" />
      {Array.from({ length: Math.floor(range / 10) }, (_, index) => (index + 1) * 10).map((meters) => {
        const r = radius(meters)
        return <g key={meters}>
          {fullCircle ? <circle cx={ox} cy={oy} r={r} className="sector-ring" />
            : <path d={`M ${ox - r} ${oy} A ${r} ${r} 0 0 1 ${ox + r} ${oy}`} className="sector-ring" />}
          {oy - r > 132 && <text x={ox + 9} y={oy - r - 4} className="sector-ring-label">{meters} м</text>}
        </g>
      })}
      {angles.map((angle, index) => {
        const end = polar(angle, extent)
        return <path key={angle} d={`M ${ox} ${oy} L ${end.x} ${end.y}`} className={index === 2 ? 'sector-spoke sector-spoke--zero' : 'sector-spoke'}><title>{marks[index]}</title></path>
      })}
      {shown.map((cast, index) => {
        const length = lineLength(cast)
        const end = polar(cast.directionDeg, length === null ? radius(cast.plannedLineM ?? 30) : radius(length))
        return <g key={cast.id}>
          <path d={`M ${ox} ${oy} L ${end.x} ${end.y}`} className={length === null ? 'sector-ray sector-ray--unknown' : 'sector-ray'} />
          {length !== null && cast.marks.map((mark) => {
            const meters = markLineLength(cast, mark.turns)
            if (meters === null) return null
            const point = polar(cast.directionDeg, radius(meters))
            return <circle key={mark.id} cx={point.x} cy={point.y} r="5" className={`sector-mark sector-mark--${mark.kind}`}><title>{bottomLabels[mark.kind]} · {mark.turns} об. · ≈{meters.toFixed(1)} м лески</title></circle>
          })}
          <circle cx={end.x} cy={end.y} r="8" className="sector-end" />
          <text x={end.x} y={end.y - 17} className="sector-cast-label">#{casts.length - shown.length + index + 1}</text>
        </g>
      })}
      {(draft || previewDirectionDeg !== null) && (() => {
        const angle = draft?.directionDeg ?? previewDirectionDeg ?? 0
        const end = polar(angle, radius(draft?.plannedLineM ?? previewLineM))
        return <g><path d={`M ${ox} ${oy} L ${end.x} ${end.y}`} className={draft ? 'sector-draft' : 'sector-preview'} /><circle cx={end.x} cy={end.y} r="10" className="sector-target" /><text x={end.x} y={end.y - 19} className="sector-draft-label">≈ {Math.round(draft?.plannedLineM ?? previewLineM)} м</text></g>
      })()}
      <circle cx={ox} cy={oy} r="7" className="sector-station" />
      <circle cx={ox} cy={oy} r="2.5" className="sector-station-core" />
      <text x={ox} y={oy + 22} className="sector-you">ТЫ</text>
    </svg>
    <div className="survey-sector-info"><span>ТВОЙ СЕКТОР</span><small>Метры ≈ · до полной подмотки это оценка{hiddenCount > 0 ? `. ${hiddenCount} старых забросов с другим ориентиром скрыто` : ''}</small></div>
    <div className="survey-sector-rail" role="group" aria-label="Управление сектором">
      <button type="button" aria-label="Направление на ориентир" title="Направление на ориентир" disabled={!onAimChange} onClick={() => onAimChange?.(0, previewLineM)}><Compass size={21} /></button>
      <div className="survey-sector-zoom"><button type="button" aria-label="Приблизить сектор" onClick={() => setRangeOverride(Math.max(minimumRange, Math.round(range * .8 / 10) * 10))}><Plus size={21} /></button><button type="button" aria-label="Отдалить сектор" onClick={() => setRangeOverride(Math.min(180, Math.round(range * 1.25 / 10) * 10))}><Minus size={21} /></button></div>
      <button type="button" aria-label="Скачать схему PNG" title="Скачать схему PNG" disabled={exporting} onClick={() => { void downloadPng() }}><DownloadSimple size={21} /></button>
    </div>
    {exportError && <p className="survey-sector-error" role="alert">{exportError}</p>}
  </div>
}
