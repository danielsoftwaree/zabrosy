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
function inside(point: PhotoPoint, quad: PhotoPoint[], tolerance = 1e-9) {
  const turns = quad.map((a, i) => cross(a, quad[(i + 1) % 4], point))
  return turns.every(t => t >= -tolerance) || turns.every(t => t <= tolerance)
}

/** Four matching water-level points define a planar perspective transform, not camera depth. */
export function photoRegistration(image: PhotoPoint[], anchors: Coordinate[]) {
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
  const toWorld = (point: PhotoPoint): Coordinate | null => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !inside(point, image)) return null
    const denominator = h[6] * point.x + h[7] * point.y + 1
    if (Math.abs(denominator) < 1e-8) return null
    const east = scale * (h[0] * point.x + h[1] * point.y + h[2]) / denominator
    const north = scale * (h[3] * point.x + h[4] * point.y + h[5]) / denominator
    return Number.isFinite(east) && Number.isFinite(north) ? fromLocalMeters(origin, east, north) : null
  }
  const toImage = (position: Coordinate): PhotoPoint | null => {
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon) || Math.abs(position.lat) > 85 || Math.abs(position.lon) > 180) return null
    const local = localMeters(origin, position)
    const point = { x: local.east, y: local.north }
    if (!inside(point, world, scale * 1e-8)) return null
    const u = point.x / scale, v = point.y / scale
    const a = h[0] - u * h[6], b = h[1] - u * h[7]
    const c = h[3] - v * h[6], d = h[4] - v * h[7]
    const determinant = a * d - b * c
    if (Math.abs(determinant) < 1e-12) return null
    const x = ((u - h[2]) * d - b * (v - h[5])) / determinant
    const y = (a * (v - h[5]) - (u - h[2]) * c) / determinant
    const result = { x, y }
    return Number.isFinite(x) && Number.isFinite(y) && inside(result, image) ? result : null
  }
  return { toWorld, toImage }
}

/** Compatibility API for selecting water points on a registered still photo. */
export function photoProjection(image: PhotoPoint[], anchors: Coordinate[]) {
  return photoRegistration(image, anchors)?.toWorld ?? null
}

export type PhotoDistanceRing = { meters: number; segments: [PhotoPoint, PhotoPoint][] }

/** Approximate horizontal distance rings, clipped to the calibrated water region. */
export function photoDistanceRings(image: PhotoPoint[], anchors: Coordinate[], station: Coordinate, stepMeters?: number): PhotoDistanceRing[] {
  const registration = photoRegistration(image, anchors)
  if (!registration || !Number.isFinite(station.lat) || !Number.isFinite(station.lon) || Math.abs(station.lat) > 85 || Math.abs(station.lon) > 180) return []
  if (stepMeters !== undefined && (!Number.isFinite(stepMeters) || stepMeters <= 0)) return []
  const world = anchors.map(position => { const { east, north } = localMeters(station, position); return { x: east, y: north } })
  const maxDistance = Math.max(...world.map(point => Math.hypot(point.x, point.y)))
  if (!Number.isFinite(maxDistance)) return []
  const desiredStep = Math.max(stepMeters ?? 0, maxDistance / 10)
  const magnitude = 10 ** Math.floor(Math.log10(desiredStep))
  const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= desiredStep)!
  const orientation = Math.sign(cross(world[0], world[1], world[2]))
  const clip = (start: PhotoPoint, end: PhotoPoint): [PhotoPoint, PhotoPoint] | null => {
    let enter = 0, leave = 1
    for (let i = 0; i < 4; i++) {
      const a = world[i], b = world[(i + 1) % 4]
      const from = orientation * cross(a, b, start)
      const to = orientation * cross(a, b, end)
      if (from < 0 && to < 0) return null
      if (from >= 0 && to >= 0) continue
      const t = from / (from - to)
      if (from < 0) enter = Math.max(enter, t)
      else leave = Math.min(leave, t)
      if (enter > leave) return null
    }
    const at = (t: number) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t })
    return [at(enter), at(leave)]
  }
  const rings: PhotoDistanceRing[] = []
  for (let meters = step; meters <= maxDistance && rings.length < 10; meters += step) {
    const segments: [PhotoPoint, PhotoPoint][] = []
    const samples = Math.min(256, Math.max(64, Math.ceil(2 * Math.PI * meters / 3)))
    for (let i = 0; i < samples; i++) {
      const angleA = i * 2 * Math.PI / samples, angleB = (i + 1) * 2 * Math.PI / samples
      const clipped = clip(
        { x: meters * Math.cos(angleA), y: meters * Math.sin(angleA) },
        { x: meters * Math.cos(angleB), y: meters * Math.sin(angleB) },
      )
      if (!clipped) continue
      const from = registration.toImage(fromLocalMeters(station, clipped[0].x, clipped[0].y))
      const to = registration.toImage(fromLocalMeters(station, clipped[1].x, clipped[1].y))
      if (from && to) segments.push([from, to])
    }
    if (segments.length) rings.push({ meters, segments })
  }
  return rings
}
