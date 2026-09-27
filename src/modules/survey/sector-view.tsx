import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Compass } from '@phosphor-icons/react/dist/csr/Compass'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Minus } from '@phosphor-icons/react/dist/csr/Minus'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { type Cast, type Draft } from '../../shared/model'
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

type Point = { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const markColors = { silt: '#8d7668', sand: '#d5a968', gravel: '#758779', shell: '#a694ae', weed: '#75a36f', edge: '#b47b59' }

export function SectorView({ casts, draft, hiddenCount = 0, previewDirectionDeg = null, onDirectionChange, previewLineM = 30, onAimChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; range: number } | null>(null)
  const [size, setSize] = useState({ width: 390, height: 844, dock: 260 })
  const [rangeOverride, setRangeOverride] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    const wrap = wrapRef.current
    const dock = wrap?.closest('.survey-panel')?.querySelector('.survey-dock')
    if (!wrap) return
    const measure = () => setSize({ width: wrap.clientWidth, height: wrap.clientHeight, dock: dock?.getBoundingClientRect().height ?? 260 })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    if (dock) observer.observe(dock)
    return () => observer.disconnect()
  }, [])

  const shown = casts.slice(-60)
  const fullCircle = [...shown.map((cast) => cast.directionDeg), draft?.directionDeg, previewDirectionDeg]
    .some((angle) => angle != null && Math.abs(angle) > 85)
  const measured = shown.map(lineLength).filter((value): value is number => value !== null)
  const contentRange = Math.max(60, Math.ceil(Math.max(previewLineM, draft?.plannedLineM ?? 0, ...measured, ...shown.map((cast) => cast.plannedLineM ?? 0)) / 10) * 10)
  const range = rangeOverride ?? contentRange
  const { width, height, dock } = size
  const ox = width / 2
  const oy = fullCircle ? Math.max(180, (height - dock + 140) / 2) : height - dock - 10
  const top = height <= 720 ? 137 : 158
  const extent = fullCircle
    ? Math.max(60, Math.min(width * .43, (height - dock - top) * .44))
    : Math.max(50, oy - top)
  const aimEnabled = Boolean(onAimChange || onDirectionChange) && !draft

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || width <= 0 || height <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = context
    const radius = (meters: number) => meters / range * extent
    const polar = (angle: number, length: number) => ({ x: ox + Math.sin(angle * Math.PI / 180) * length, y: oy - Math.cos(angle * Math.PI / 180) * length })
    const line = (from: Point, to: Point, color: string, thickness = 1, dash: number[] = []) => {
      g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y)
      g.strokeStyle = color; g.lineWidth = thickness; g.setLineDash(dash); g.stroke(); g.setLineDash([])
    }
    const dot = (at: Point, r: number, color: string, stroke = '#fff') => {
      g.beginPath(); g.arc(at.x, at.y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill()
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke() }
    }
    const label = (value: string, x: number, y: number, color = '#627f72', bold = false, pill = false) => {
      g.font = `${bold ? 700 : 500} ${pill ? 12 : 10}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      g.textAlign = 'center'; g.textBaseline = 'middle'
      if (pill) {
        const labelWidth = g.measureText(value).width
        g.fillStyle = '#f4f9e7'; g.beginPath(); g.roundRect(x - labelWidth / 2 - 8, y - 12, labelWidth + 16, 24, 8); g.fill()
      }
      g.fillStyle = color; g.fillText(value, x, y)
    }
    g.fillStyle = '#e7efea'; g.fillRect(0, 0, width, height)
    const glow = g.createRadialGradient(ox, oy, 0, ox, oy, extent)
    glow.addColorStop(0, '#d8e7d9'); glow.addColorStop(1, '#edf2e9')
    g.fillStyle = glow; g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, extent, Math.PI + .07, -.07); g.closePath(); g.fill()
    const increment = range <= 40 ? 5 : range <= 100 ? 10 : 20
    for (let meters = increment; meters <= range; meters += increment) {
      const r = radius(meters)
      g.beginPath(); g.arc(ox, oy, r, fullCircle ? 0 : Math.PI, fullCircle ? Math.PI * 2 : 0)
      g.strokeStyle = meters % 20 === 0 ? '#bacfc0' : '#cbdcd0'; g.lineWidth = 1; g.stroke()
      if (oy - r > top + 8) label(`${meters} м лески`, ox + 31, oy - r - 5, '#5b7869')
    }
    for (const angle of [-60, -30, 0, 30, 60]) line({ x: ox, y: oy }, polar(angle, extent), angle === 0 ? '#8fb2a1' : '#c3d5c8', 1, [3, 7])
    shown.forEach((cast, index) => {
      const length = lineLength(cast)
      const end = polar(cast.directionDeg, radius(length ?? cast.plannedLineM ?? 30))
      line({ x: ox, y: oy }, end, length === null ? '#7a9b8d' : '#2c715a', length === null ? 1.4 : 2, length === null ? [5, 5] : [])
      if (length !== null) cast.marks.forEach((mark) => {
        const meters = markLineLength(cast, mark.turns)
        if (meters !== null) dot(polar(cast.directionDeg, radius(meters)), 5, markColors[mark.kind])
      })
      dot(end, 8, '#d8f285', '#18594a')
      label(`#${casts.length - shown.length + index + 1}`, end.x, end.y - 18, '#18594a', true)
    })
    if (draft || previewDirectionDeg !== null) {
      const end = polar(draft?.directionDeg ?? previewDirectionDeg ?? 0, radius(draft?.plannedLineM ?? previewLineM))
      line({ x: ox, y: oy }, end, draft ? '#ba6340' : '#18594a', 2, [5, 5])
      dot(end, 11, '#d8f285', '#18594a'); dot(end, 3, '#18594a', '')
      label(`≈ ${Math.round(draft?.plannedLineM ?? previewLineM)} м лески`, clamp(end.x, 66, width - 66), end.y - 29, '#18594a', true, true)
    }
    g.fillStyle = '#d4dfcf'; g.beginPath(); g.moveTo(0, oy + 27)
    g.quadraticCurveTo(ox, oy + 7, width, oy + 27); g.lineTo(width, height); g.lineTo(0, height); g.closePath(); g.fill()
    dot({ x: ox, y: oy }, 7, '#18594a'); dot({ x: ox, y: oy }, 2.8, '#e4f5b2', '')
    label('ТЫ', ox, oy + 20, '#527c63', true)
  }, [casts, draft, shown, previewDirectionDeg, previewLineM, range, width, height, ox, oy, extent, top, fullCircle])

  const local = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const choose = (point: Point) => {
    if (!aimEnabled) return
    const dx = point.x - ox
    const dy = oy - point.y
    if (!fullCircle && dy < 0) return
    const degrees = clamp(Math.round(Math.atan2(dx, dy) * 180 / Math.PI), -180, 180)
    const meters = clamp(Math.round(Math.hypot(dx, dy) / extent * range), 1, 180)
    if (onAimChange) onAimChange(degrees, meters)
    else onDirectionChange?.(degrees)
  }
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, local(event))
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), range }
    }
    event.preventDefault()
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    const point = local(event)
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      setRangeOverride(clamp(Math.round(pinch.current.range * pinch.current.distance / Math.max(5, distance)), 15, 180))
    } else if (!pinch.current) choose(point)
    event.preventDefault()
  }
  const onPointerEnd = (event: PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    if (!cancelled && !pinch.current) choose(local(event))
    if (pointers.current.size === 0) pinch.current = null
    event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!aimEnabled) return
    const direction = previewDirectionDeg ?? 0
    let nextDirection = direction
    let nextLine = previewLineM
    if (event.key === 'ArrowLeft') nextDirection -= 1
    else if (event.key === 'ArrowRight') nextDirection += 1
    else if (event.key === 'ArrowUp') nextLine += 1
    else if (event.key === 'ArrowDown') nextLine -= 1
    else return
    event.preventDefault()
    if (onAimChange) onAimChange(clamp(nextDirection, -180, 180), clamp(nextLine, 1, 180))
    else onDirectionChange?.(clamp(nextDirection, -180, 180))
  }
  async function downloadPng() {
    if (!canvasRef.current || exporting) return
    setExporting(true); setExportError('')
    try {
      const png = await sectorToPng(canvasRef.current)
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url; link.download = `marker-sector-${new Date().toISOString().slice(0, 10)}.png`
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setExportError(error instanceof Error ? error.message : 'PNG не создан.') }
    finally { setExporting(false) }
  }

  return <div className="survey-sector-wrap" ref={wrapRef}>
    <canvas ref={canvasRef} className="survey-sector" role="group" tabIndex={aimEnabled ? 0 : -1}
      aria-label={`Схема сектора. ${casts.length} забросов в текущем ориентире. Стрелки влево и вправо меняют направление, вверх и вниз — длину лески.`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => onPointerEnd(event)} onPointerCancel={(event) => onPointerEnd(event, true)}
      onContextMenu={(event) => event.preventDefault()} onKeyDown={onKeyDown} />
    <div className="survey-sector-info"><span>ТВОЙ СЕКТОР</span><small>Метры по леске · до полной подмотки это оценка{hiddenCount > 0 ? `. ${hiddenCount} старых забросов с другим ориентиром скрыто` : ''}</small></div>
    <div className="survey-sector-rail" role="group" aria-label="Управление сектором">
      <button type="button" aria-label="Направление на ориентир" title="Направление на ориентир" disabled={!onAimChange} onClick={() => onAimChange?.(0, previewLineM)}><Compass size={21} /></button>
      <div className="survey-sector-zoom"><button type="button" aria-label="Приблизить сектор" onClick={() => setRangeOverride(clamp(Math.round(range * .8), 15, 180))}><Plus size={21} /></button><button type="button" aria-label="Отдалить сектор" onClick={() => setRangeOverride(clamp(Math.round(range * 1.25), 15, 180))}><Minus size={21} /></button></div>
      <button type="button" aria-label="Скачать схему PNG" title="Скачать схему PNG" disabled={exporting} onClick={() => { void downloadPng() }}><DownloadSimple size={21} /></button>
    </div>
    {exportError && <p className="survey-sector-error" role="alert">{exportError}</p>}
  </div>
}
