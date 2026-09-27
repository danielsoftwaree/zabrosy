import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowsOutSimple } from '@phosphor-icons/react/dist/csr/ArrowsOutSimple'
import type { DepthPoint } from './bottom'
import './bottom.css'

type XY = { x: number; y: number }
export type PlotPoint = DepthPoint & XY
export type DepthPlot = {
  points: PlotPoint[]
  cells: { corners: XY[]; color: string }[]
  lines: { from: XY; to: XY; dashed?: boolean }[]
  plane: XY[]
  labels: { at: XY; text: string }[]
  station: XY | null
}
type Viewport = { scale: number; x: number; y: number }
const initialView: Viewport = { scale: 1, x: 0, y: 0 }

export function nearestDepthPoint(points: PlotPoint[], at: XY, radius: number) {
  let nearest: PlotPoint | null = null
  let distance = radius
  for (const point of points) {
    const candidate = Math.hypot(point.x - at.x, point.y - at.y)
    if (candidate <= distance) { nearest = point; distance = candidate }
  }
  return nearest
}

export function BottomCanvas({ plot, label, rotate }: { plot: DepthPlot; label: string; rotate?: (degrees: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 320, height: 320 })
  const [view, setView] = useState(initialView)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = plot.points.find(point => point.id === selectedId) ?? null
  const pointers = useRef(new Map<number, XY>())
  const gesture = useRef<{ start: XY; last: XY; view: Viewport; distance: number; moved: boolean } | null>(null)
  const factor = Math.min(size.width, size.height) / 320
  const offset = { x: (size.width - factor * 320) / 2, y: (size.height - factor * 320) / 2 }
  const selectedSource = selected?.source === 'manual' ? 'Ручной замер' : selected?.source === 'marker-float' ? 'Маркерный поплавок' : selected?.source

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const resize = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }))
    resize.observe(element)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    element.width = Math.round(size.width * ratio)
    element.height = Math.round(size.height * ratio)
    context.scale(ratio, ratio)
    context.fillStyle = '#fafbf8'
    context.fillRect(0, 0, size.width, size.height)
    context.translate(offset.x + factor * view.x, offset.y + factor * view.y)
    context.scale(factor * view.scale, factor * view.scale)
    const unit = 1 / (factor * view.scale)
    const polygon = (corners: XY[], color: string) => {
      if (!corners.length) return
      context.beginPath()
      corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
      context.closePath()
      context.fillStyle = color
      context.fill()
    }
    polygon(plot.plane, '#edf3ee')
    for (const cell of plot.cells) polygon(cell.corners, cell.color)
    context.strokeStyle = '#a9bcb0'
    context.lineWidth = unit
    for (const line of plot.lines) {
      context.setLineDash(line.dashed ? [4 * unit, 5 * unit] : [])
      context.beginPath(); context.moveTo(line.from.x, line.from.y); context.lineTo(line.to.x, line.to.y); context.stroke()
    }
    context.setLineDash([])
    context.font = `600 ${12 * unit}px system-ui, sans-serif`
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    const text = (value: string, x: number, y: number) => {
      context.strokeStyle = '#fafbf8'
      context.lineWidth = 3 * unit
      context.strokeText(value, x, y)
      context.fillStyle = '#283f35'; context.fillText(value, x, y)
    }
    for (const point of plot.points) {
      context.beginPath(); context.arc(point.x, point.y, (selected?.id === point.id ? 8 : 5) * unit, 0, Math.PI * 2)
      context.fillStyle = selected?.id === point.id ? '#18594a' : '#c56644'; context.fill()
      context.lineWidth = 2 * unit; context.strokeStyle = '#fff'; context.stroke()
      if (plot.points.length <= 30 || selected?.id === point.id) text(`${point.meters.toFixed(1)} м`, point.x + 9 * unit, point.y - 11 * unit)
    }
    if (plot.station) {
      context.beginPath(); context.arc(plot.station.x, plot.station.y, 6 * unit, 0, Math.PI * 2)
      context.fillStyle = '#18594a'; context.fill()
    }
    for (const item of plot.labels) text(item.text, item.at.x, item.at.y)
  }, [plot, size, view, selected, factor, offset.x, offset.y])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const at = { x: (event.clientX - rect.left - offset.x) / factor, y: (event.clientY - rect.top - offset.y) / factor }
      setView(current => {
        const scale = Math.max(.6, Math.min(8, current.scale * Math.exp(-event.deltaY * .002)))
        return { scale, x: at.x - (at.x - current.x) * scale / current.scale, y: at.y - (at.y - current.y) * scale / current.scale }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [factor, offset.x, offset.y])

  function location(event: PointerEvent<HTMLCanvasElement>): XY {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left - offset.x) / factor, y: (event.clientY - rect.top - offset.y) / factor }
  }
  function begin() {
    const [a, b] = [...pointers.current.values()]
    if (!a) { gesture.current = null; return }
    const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
    gesture.current = { start: center, last: center, view, distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, moved: Boolean(b) }
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return
    pointers.current.set(event.pointerId, location(event))
    const [a, b] = [...pointers.current.values()]
    const state = gesture.current
    const at = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
    if (Math.hypot(at.x - state.start.x, at.y - state.start.y) > 4) state.moved = true
    if (b && state.distance > 0) {
      const scale = Math.max(.6, Math.min(8, state.view.scale * Math.hypot(a.x - b.x, a.y - b.y) / state.distance))
      setView({ scale, x: at.x - (state.start.x - state.view.x) * scale / state.view.scale, y: at.y - (state.start.y - state.view.y) * scale / state.view.scale })
    } else if (rotate) rotate((at.x - state.last.x) * .65)
    else setView({ ...state.view, x: state.view.x + at.x - state.start.x, y: state.view.y + at.y - state.start.y })
    state.last = at
  }
  function end(event: PointerEvent<HTMLCanvasElement>) {
    const state = gesture.current
    if (state && !state.moved && event.type === 'pointerup') {
      const at = location(event)
      setSelectedId(nearestDepthPoint(plot.points, { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale }, 18 / (factor * view.scale))?.id ?? null)
    }
    pointers.current.delete(event.pointerId)
    begin()
    if (gesture.current) gesture.current.moved = true
  }
  return <div className="depth-explorer">
    <canvas ref={canvas} className="map-bottom__plot" role="img" aria-label={label} aria-describedby="depth-gestures" tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, location(event)); begin() }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={event => {
        if (['+', '=', '-', 'Home', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault()
        if (event.key === 'Home') setView(initialView)
        else if (event.key === 'Enter') setSelectedId(plot.points[(plot.points.findIndex(point => point.id === selectedId) + 1) % plot.points.length]?.id ?? null)
        else if (event.key === '+' || event.key === '=' || event.key === '-') setView(current => ({ ...current, scale: Math.max(.6, Math.min(8, current.scale * (event.key === '-' ? .8 : 1.25))) }))
        else if (rotate && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) rotate(event.key === 'ArrowLeft' ? -10 : 10)
        else if (event.key.startsWith('Arrow')) setView(current => ({ ...current, x: current.x + (event.key === 'ArrowLeft' ? 15 : event.key === 'ArrowRight' ? -15 : 0), y: current.y + (event.key === 'ArrowUp' ? 15 : event.key === 'ArrowDown' ? -15 : 0) }))
      }} />
    <button className="depth-explorer__fit" type="button" onClick={() => { setView(initialView); setSelectedId(null) }} aria-label="Показать все глубины" title="Показать все глубины"><ArrowsOutSimple size={20} /></button>
    <p className="depth-explorer__hint" id="depth-gestures">{rotate ? 'Потяните для поворота' : 'Двигайте одним пальцем'} · масштаб двумя · касание точки</p>
    {selected && <div className="depth-explorer__point" role="status"><strong>{selected.meters.toFixed(1)} м</strong><span>{selectedSource}</span><small>{selected.position.lat.toFixed(6)}, {selected.position.lon.toFixed(6)}</small><button type="button" onClick={() => setSelectedId(null)} aria-label="Закрыть глубину">Закрыть</button></div>}
  </div>
}
