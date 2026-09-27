import type { Coordinate } from '../../shared/model'
import { localMeters } from './geometry'

export function AnchorGuide({ anchors, station, current }: { anchors: Coordinate[]; station: Coordinate; current: number }) {
  const local = anchors.map(p => localMeters(station, p))
  const center = local.reduce((sum, p) => ({ east: sum.east + p.east / 4, north: sum.north + p.north / 4 }), { east: 0, north: 0 })
  const angle = Math.atan2(center.east, center.north)
  const rotated = local.map(p => ({ x: p.east * Math.cos(angle) - p.north * Math.sin(angle), y: -(p.east * Math.sin(angle) + p.north * Math.cos(angle)) }))
  const extent = Math.max(1, ...rotated.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const points = rotated.map(p => ({ x: 100 + p.x / extent * 70, y: 100 + p.y / extent * 75 }))
  return <svg className="photo-anchor-guide" viewBox="0 0 200 120" role="img" aria-label="Схема четырёх точек. Ваше место снизу, дальний берег сверху">
    <polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="#edf3e7" stroke="#18594a" strokeWidth="1.5" />
    {points.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="10" fill={i === current ? '#d8f285' : '#fbfcf8'} stroke="#18594a" /><text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fill="#18594a">{i + 1}</text></g>)}
    <circle cx="100" cy="108" r="3" fill="#18594a" /><text x="109" y="112" fontSize="10" fill="#18594a">Вы</text>
  </svg>
}

