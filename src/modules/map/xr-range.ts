export type XrPoint = { x: number; y: number; z: number }
export type XrQuaternion = { x: number; y: number; z: number; w: number }
export type XrRangeResult = { distanceM: number; source: 'surface' | 'water-plane' }
export type XrRangeCapture = XrRangeResult & { measuredAt: number; waterLevelY?: number; heightM?: number }

export type XrSample = { at: number; camera: XrPoint; target: XrPoint; direction: XrPoint }

const finitePoint = (point: XrPoint) => [point.x, point.y, point.z].every(Number.isFinite)

export function horizontalDistance(a: XrPoint, b: XrPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function shoreHitEligible(camera: XrPoint, target: XrPoint): boolean {
  return finitePoint(camera) && finitePoint(target) && camera.y - target.y >= 0.2
    && Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z) <= 5
}

/** The viewer's centre ray is local -Z transformed by its tracking quaternion. */
export function viewerDirection(q: XrQuaternion, ray: XrPoint = { x: 0, y: 0, z: -1 }): XrPoint | null {
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || !finitePoint(ray)) return null
  const length = Math.hypot(q.x, q.y, q.z, q.w)
  if (length < 0.5 || length > 1.5) return null
  const { x, y, z, w } = q
  const direction = {
    x: ray.x + 2 * (w * (y * ray.z - z * ray.y) + x * (x * ray.x + y * ray.y + z * ray.z) - ray.x * (x * x + y * y + z * z)) / (length * length),
    y: ray.y + 2 * (w * (z * ray.x - x * ray.z) + y * (x * ray.x + y * ray.y + z * ray.z) - ray.y * (x * x + y * y + z * z)) / (length * length),
    z: ray.z + 2 * (w * (x * ray.y - y * ray.x) + z * (x * ray.x + y * ray.y + z * ray.z) - ray.z * (x * x + y * y + z * z)) / (length * length),
  }
  const magnitude = Math.hypot(direction.x, direction.y, direction.z)
  return finitePoint(direction) && magnitude > 0 ? { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude } : null
}

export function screenCentreRay(projection: ArrayLike<number>): XrPoint | null {
  const x = projection[8] / projection[0]
  const y = projection[9] / projection[5]
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 1 && Math.abs(y) <= 1
    ? { x, y, z: -1 } : null
}

/** Intersect a tracked centre ray with a user-confirmed horizontal water level. */
export function waterPlaneTarget(camera: XrPoint, direction: XrPoint, waterLevelY: number): XrPoint | null {
  if (!finitePoint(camera) || !finitePoint(direction) || !Number.isFinite(waterLevelY)) return null
  const heightM = camera.y - waterLevelY
  const horizontal = Math.hypot(direction.x, direction.z)
  // Below 5 degrees, a small aiming error changes the distance dramatically.
  if (heightM < 0.2 || direction.y >= -Math.sin(5 * Math.PI / 180) || horizontal < 0.01) return null
  const scale = -heightM / direction.y
  if (!Number.isFinite(scale) || scale <= 0) return null
  const target = { x: camera.x + direction.x * scale, y: waterLevelY, z: camera.z + direction.z * scale }
  return finitePoint(target) && horizontalDistance(camera, target) <= 200 ? target : null
}

/** Stable means a fresh tracked point, a steady viewer, and agreement across frames. */
export function stableXrTarget(samples: XrSample[], now: number): XrSample | null {
  if (!Number.isFinite(now)) return null
  const recent = samples.filter(sample => sample.at <= now && now - sample.at <= 900)
  if (recent.length < 5 || now - recent[recent.length - 1].at > 200 || recent[recent.length - 1].at - recent[0].at < 400) return null
  if (recent.some((sample, index) => index > 0 && sample.at - recent[index - 1].at > 200)) return null
  const middle = recent[Math.floor(recent.length / 2)]
  if (!finitePoint(middle.camera) || !finitePoint(middle.target) || !finitePoint(middle.direction)) return null
  for (const sample of recent) {
    if (!finitePoint(sample.camera) || !finitePoint(sample.target) || !finitePoint(sample.direction)
      || Math.hypot(sample.camera.x - middle.camera.x, sample.camera.y - middle.camera.y, sample.camera.z - middle.camera.z) > 0.25
      || Math.hypot(sample.target.x - middle.target.x, sample.target.y - middle.target.y, sample.target.z - middle.target.z) > 0.25
      || Math.hypot(sample.direction.x - middle.direction.x, sample.direction.y - middle.direction.y, sample.direction.z - middle.direction.z) > 0.025) return null
  }
  return recent[recent.length - 1]
}
