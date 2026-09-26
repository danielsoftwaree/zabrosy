export type DepthSample = { east: number; north: number; meters: number }
const cross = (a: DepthSample, b: DepthSample, c: DepthSample) => (b.east - a.east) * (c.north - a.north) - (b.north - a.north) * (c.east - a.east)
export function convexHull(points: DepthSample[]): DepthSample[] {
  const sorted = [...new Map(points.map(point => [`${point.east},${point.north}`, point])).values()].sort((a, b) => a.east - b.east || a.north - b.north)
  if (sorted.length < 3) return []
  const half = (list: DepthSample[]) => {
    const result: DepthSample[] = []
    for (const point of list) {
      while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop()
      result.push(point)
    }
    return result
  }
  const lower = half(sorted), upper = half([...sorted].reverse())
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return hull.length >= 3 ? hull : []
}
export function estimateDepth(points: DepthSample[], hull: DepthSample[], east: number, north: number, maxGapM: number): number | null {
  const query = { east, north, meters: 0 }
  if (hull.length < 3 || hull.some((point, i) => cross(point, hull[(i + 1) % hull.length], query) < -1e-8)) return null
  const nearby = points.map(point => ({ point, distance: Math.hypot(point.east - east, point.north - north) }))
    .filter(item => item.distance <= maxGapM).sort((a, b) => a.distance - b.distance).slice(0, 4)
  if (nearby[0]?.distance < 1e-6) return nearby[0].point.meters
  if (nearby.length < 3) return null
  let weight = 0, sum = 0
  for (const item of nearby) { const w = 1 / item.distance ** 2; weight += w; sum += item.point.meters * w }
  return sum / weight
}
