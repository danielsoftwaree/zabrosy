import type { Cast, Coordinate } from '../../shared/model'
import { lineLength } from '../survey'
import { distanceMeters, fromLocalMeters, locationPercent, type MapBounds } from './geometry'
import './imagery-overlay.css'

type Props = {
  bounds: MapBounds
  station: Coordinate | null
  referenceBearingDeg: number | null
  target: Coordinate | null
  casts: Cast[]
  candidate: Coordinate | null
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const visible = ({ x, y }: { x: number; y: number }) => x >= 0 && x <= 100 && y >= 0 && y <= 100
const labelPosition = (point: { x: number; y: number }, above = false) => ({ left: `clamp(90px, ${point.x}%, calc(100% - 90px))`, top: `${clamp(point.y + (above ? -5 : 5), 7, 93)}%` })

function referenceEnd(bounds: MapBounds, station: Coordinate, bearing: number) {
  const start = locationPercent(bounds, station)
  const radians = bearing * Math.PI / 180
  const ahead = locationPercent(bounds, fromLocalMeters(station, Math.sin(radians) * 10, Math.cos(radians) * 10))
  const dx = ahead.x - start.x
  const dy = ahead.y - start.y
  const distances = [dx > 0 ? (100 - start.x) / dx : dx < 0 ? -start.x / dx : Infinity,
    dy > 0 ? (100 - start.y) / dy : dy < 0 ? -start.y / dy : Infinity].filter(value => value > 0)
  const step = Math.min(...distances)
  return { x: start.x + dx * step, y: start.y + dy * step }
}

function castLabel(cast: Cast, index: number) {
  if (cast.target && cast.depthPosition && cast.depth?.source !== 'chart' && cast.depth && distanceMeters(cast.target, cast.depthPosition) < 1) {
    return `#${index + 1} · ${cast.depth.meters.toFixed(1)} м глубина`
  }
  const meters = lineLength(cast)
  return meters === null ? `#${index + 1}` : `#${index + 1} · ≈${Math.round(meters)} м леска`
}

function niceScale(meters: number) {
  const power = 10 ** Math.floor(Math.log10(meters))
  return [5, 2, 1].map(value => value * power).find(value => value <= meters) ?? power / 2
}

export function ImageryOverlay({ bounds, station, referenceBearingDeg, target, casts, candidate }: Props) {
  const at = (point: Coordinate) => locationPercent(bounds, point)
  const bank = station ? at(station) : null
  const aim = target ? at(target) : null
  const pending = candidate ? at(candidate) : null
  const reference = station && referenceBearingDeg !== null && bank && visible(bank) ? referenceEnd(bounds, station, referenceBearingDeg) : null
  const widthMeters = distanceMeters({ lat: (bounds.north + bounds.south) / 2, lon: bounds.west }, { lat: (bounds.north + bounds.south) / 2, lon: bounds.east })
  const scaleMeters = niceScale(widthMeters * .2)
  const scaleWidth = scaleMeters / widthMeters * 100

  return <div className="imagery-overlay" aria-hidden="true">
    <svg className="imagery-overlay__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
      {reference && bank && <line x1={bank.x} y1={bank.y} x2={reference.x} y2={reference.y} className="imagery-overlay__ray imagery-overlay__ray--reference" vectorEffect="non-scaling-stroke" />}
      {bank && aim && <line x1={bank.x} y1={bank.y} x2={aim.x} y2={aim.y} className="imagery-overlay__ray imagery-overlay__ray--target" vectorEffect="non-scaling-stroke" />}
      {casts.map(cast => cast.station.position && cast.target ? (() => { const start = at(cast.station.position), end = at(cast.target); return <line key={cast.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="imagery-overlay__ray imagery-overlay__ray--cast" vectorEffect="non-scaling-stroke" /> })() : null)}
    </svg>
    {reference && bank && <span className="imagery-overlay__label imagery-overlay__label--reference" style={labelPosition({ x: bank.x + (reference.x - bank.x) * .7, y: bank.y + (reference.y - bank.y) * .7 }, true)}>0° · ориентир</span>}
    {bank && visible(bank) && <><span className="imagery-overlay__mark imagery-overlay__mark--station field-map__marker--station" style={{ left: `${bank.x}%`, top: `${bank.y}%` }} /><span className="imagery-overlay__label" style={labelPosition(bank)}>БЕРЕГ</span></>}
    {casts.map((cast, index) => { if (!cast.target) return null; const point = at(cast.target); if (!visible(point)) return null; return <div key={cast.id}><span className="imagery-overlay__mark imagery-overlay__mark--cast" style={{ left: `${point.x}%`, top: `${point.y}%` }}>{index + 1}</span><span className="imagery-overlay__label imagery-overlay__label--cast" style={labelPosition(point, true)}>{castLabel(cast, index)}</span></div> })}
    {aim && visible(aim) && <><span className="imagery-overlay__mark imagery-overlay__mark--target" style={{ left: `${aim.x}%`, top: `${aim.y}%` }} /><span className="imagery-overlay__label imagery-overlay__label--target" style={labelPosition(aim, true)}>{station ? `Цель · ≈${Math.round(distanceMeters(station, target!))} м по карте` : 'Цель'}</span></>}
    {pending && visible(pending) && <><span className="imagery-overlay__mark imagery-overlay__mark--candidate" style={{ left: `${pending.x}%`, top: `${pending.y}%` }} /><span className="imagery-overlay__label" style={labelPosition(pending)}>Выбрана точка</span></>}
    {widthMeters > 0 && Number.isFinite(scaleWidth) && <div className="imagery-overlay__scale" style={{ width: `${scaleWidth}%` }}><span>{scaleMeters} м на карте</span><i /></div>}
  </div>
}
