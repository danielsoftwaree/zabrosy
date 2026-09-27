import type { Coordinate } from '../../shared/model'
import { fromLocalMeters, localMeters } from './geometry'

export type PhotoPoint = { x: number; y: number }
const cross = (a: PhotoPoint, b: PhotoPoint, c: PhotoPoint) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
export function validQuad(points: PhotoPoint[]): boolean {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const turns = points.map((a, i) => cross(a, points[(i + 1) % 4], points[(i + 2) % 4]))
  const scale = Math.max(...points.map((a, i) => Math.hypot(a.x - points[(i + 1) % 4].x, a.y - points[(i + 1) % 4].y)))
  return scale > 0 && turns.every(t => Math.abs(t) > scale * scale * .005 && Math.sign(t) === Math.sign(turns[0]))
}
function inside(point: PhotoPoint, quad: PhotoPoint[]) {
  const turns = quad.map((a, i) => cross(a, quad[(i + 1) % 4], point))
  return turns.every(t => t >= -1e-9) || turns.every(t => t <= 1e-9)
}

/** Four matching water-level points define a planar perspective transform, not camera depth. */
export function photoProjection(image: PhotoPoint[], anchors: Coordinate[]) {
  if (!validQuad(image) || image.some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) || anchors.length !== 4) return null
  if (anchors.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 85 || Math.abs(p.lon) > 180)) return null
  const origin = anchors[0]
  const world = anchors.map(p => { const local = localMeters(origin, p); return { x: local.east, y: local.north } })
  if (!validQuad(world)) return null
  const scale = Math.max(...world.map(p => Math.hypot(p.x, p.y)))
  if (scale < 2 || scale > 5000) return null
  const rows = image.flatMap(({ x, y }, i) => {
    const u = world[i].x / scale, v = world[i].y / scale
    return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]]
  })
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    if (Math.abs(rows[pivot][col]) < 1e-10) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    const divisor = rows[col][col]
    rows[col] = rows[col].map(value => value / divisor)
    for (let row = 0; row < 8; row++) {
      if (row === col) continue
      const factor = rows[row][col]
      rows[row] = rows[row].map((value, index) => value - factor * rows[col][index])
    }
  }
  const h = rows.map(row => row[8])
  const denominators = image.map(p => h[6] * p.x + h[7] * p.y + 1)
  if (denominators.some(value => !Number.isFinite(value) || Math.abs(value) < 1e-8 || Math.sign(value) !== Math.sign(denominators[0]))) return null
  return (point: PhotoPoint): Coordinate | null => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !inside(point, image)) return null
    const denominator = h[6] * point.x + h[7] * point.y + 1
    if (Math.abs(denominator) < 1e-8) return null
    const east = scale * (h[0] * point.x + h[1] * point.y + h[2]) / denominator
    const north = scale * (h[3] * point.x + h[4] * point.y + h[5]) / denominator
    return Number.isFinite(east) && Number.isFinite(north) ? fromLocalMeters(origin, east, north) : null
  }
}
