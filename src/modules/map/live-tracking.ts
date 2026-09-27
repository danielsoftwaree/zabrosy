import jsfeat from 'jsfeat'
import { validQuad, type PhotoPoint } from './photo-geometry'

export type TrackingResult =
  | { status: 'tracked'; corners: PhotoPoint[]; confidence: number }
  | { status: 'lost'; reason: 'frame' | 'gap' | 'features' | 'motion' }

export type LiveTracker = { update(frame: ImageData, timestamp: number): TrackingResult }

type Feature = { x: number; y: number; group: number }
type GrayFrame = { image: InstanceType<typeof jsfeat.matrix_t>; pyramid: InstanceType<typeof jsfeat.pyramid_t> }

const MAX_SIDE = 320
const MAX_FEATURES_PER_GROUP = 18
const MIN_FEATURES = 16
const MAX_GAP_MS = 750

function usableFrame(frame: ImageData) {
  return Number.isInteger(frame.width) && Number.isInteger(frame.height) &&
    frame.width >= 120 && frame.height >= 120 &&
    frame.data.length === frame.width * frame.height * 4
}

function grayFrame(frame: ImageData, width: number, height: number): GrayFrame {
  const image = new jsfeat.matrix_t(width, height, jsfeat.U8C1_t)
  const pixels = image.data
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(frame.height - 1, Math.floor((y + .5) * frame.height / height))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(frame.width - 1, Math.floor((x + .5) * frame.width / width))
      const source = (sourceY * frame.width + sourceX) * 4
      pixels[y * width + x] = Math.round((frame.data[source] * 77 + frame.data[source + 1] * 150 + frame.data[source + 2] * 29) / 256)
    }
  }
  const pyramid = new jsfeat.pyramid_t(3)
  pyramid.allocate(width, height, jsfeat.U8C1_t)
  pyramid.build(image, false)
  return { image, pyramid }
}

function shoreGroup(point: PhotoPoint, corners: PhotoPoint[], width: number, height: number): number {
  const center = corners.reduce((sum, corner) => ({ x: sum.x + corner.x / 4, y: sum.y + corner.y / 4 }), { x: 0, y: 0 })
  for (const [shore, a, b] of [[0, 0, 1], [1, 2, 3]]) {
    const start = corners[a], end = corners[b]
    const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height
    const length = Math.hypot(dx, dy)
    if (length < 30) continue
    const px = (point.x - start.x) * width, py = (point.y - start.y) * height
    const along = (px * dx + py * dy) / (length * length)
    const side = (dx * py - dy * px) / length
    const centerSide = (dx * (center.y - start.y) * height - dy * (center.x - start.x) * width) / length
    const outside = side * Math.sign(centerSide) < -3
    if (outside && along >= .02 && along <= .98 && Math.abs(side) <= Math.min(width, height) * .22) {
      return shore * 2 + (along < .5 ? 0 : 1)
    }
  }
  return -1
}

function selectFeatures(image: GrayFrame['image'], corners: PhotoPoint[]): Feature[] {
  const { cols: width, rows: height } = image
  // yape06 writes into supplied keypoints. Its horizontal skip limits the output to half the pixels.
  const candidates = Array.from({ length: Math.ceil(width * height / 2) }, () => new jsfeat.keypoint_t())
  const count = jsfeat.yape06.detect(image, candidates, 12)
  const chosen: Feature[] = []
  const groups = [0, 0, 0, 0]
  const sorted = candidates.slice(0, count).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const candidate of sorted) {
    const group = shoreGroup({ x: candidate.x / width, y: candidate.y / height }, corners, width, height)
    if (group < 0 || groups[group] >= MAX_FEATURES_PER_GROUP) continue
    if (chosen.some(feature => Math.hypot(feature.x - candidate.x, feature.y - candidate.y) < 11)) continue
    chosen.push({ x: candidate.x, y: candidate.y, group })
    groups[group]++
    if (chosen.length === MAX_FEATURES_PER_GROUP * 4) break
  }
  return chosen
}

function spread(features: Feature[]): boolean {
  const groups = [0, 0, 0, 0]
  for (const feature of features) groups[feature.group]++
  return features.length >= MIN_FEATURES && groups.filter(count => count >= 3).length >= 3 &&
    groups[0] + groups[1] >= 5 && groups[2] + groups[3] >= 5
}

function transformed(point: PhotoPoint, data: Uint8Array | Float32Array): PhotoPoint | null {
  const denominator = data[6] * point.x + data[7] * point.y + data[8]
  if (!Number.isFinite(denominator) || denominator <= 1e-5) return null
  const x = (data[0] * point.x + data[1] * point.y + data[2]) / denominator
  const y = (data[3] * point.x + data[4] * point.y + data[5]) / denominator
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** Tracks a short continuous camera move. The caller supplies successive frames at the same size. */
export function createLiveTracker(corners: PhotoPoint[], frame: ImageData, timestamp: number): LiveTracker | null {
  if (!usableFrame(frame) || !Number.isFinite(timestamp) || !validQuad(corners) ||
    corners.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return null
  const ratio = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height))
  const sourceWidth = frame.width, sourceHeight = frame.height
  const width = Math.round(frame.width * ratio), height = Math.round(frame.height * ratio)
  if (Math.min(width, height) < 80) return null
  let previous = grayFrame(frame, width, height)
  let features = selectFeatures(previous.image, corners)
  if (!spread(features)) return null
  let currentCorners = corners.map(point => ({ ...point }))
  let lastTimestamp = timestamp
  let lost: TrackingResult | null = null

  return {
    update(nextFrame, nextTimestamp) {
      if (lost) return lost
      const fail = (reason: 'frame' | 'gap' | 'features' | 'motion'): TrackingResult => {
        lost = { status: 'lost', reason }
        return lost
      }
      if (!usableFrame(nextFrame) || nextFrame.width !== sourceWidth || nextFrame.height !== sourceHeight) return fail('frame')
      if (!Number.isFinite(nextTimestamp) || nextTimestamp <= lastTimestamp || nextTimestamp - lastTimestamp > MAX_GAP_MS) return fail('gap')
      const current = grayFrame(nextFrame, width, height)
      const count = features.length
      const fromXY = new Float32Array(count * 2), toXY = new Float32Array(count * 2)
      features.forEach((feature, index) => { fromXY[index * 2] = feature.x; fromXY[index * 2 + 1] = feature.y })
      const forward = new Uint8Array(count)
      jsfeat.optical_flow_lk.track(previous.pyramid, current.pyramid, fromXY, toXY, count, 11, 20, forward, .01, .0001)
      const backXY = new Float32Array(count * 2), backward = new Uint8Array(count)
      jsfeat.optical_flow_lk.track(current.pyramid, previous.pyramid, toXY, backXY, count, 11, 20, backward, .01, .0001)
      const from: Feature[] = [], to: Feature[] = []
      for (let index = 0; index < count; index++) {
        const x = toXY[index * 2], y = toXY[index * 2 + 1]
        if (!forward[index] || !backward[index] || !Number.isFinite(x) || !Number.isFinite(y)) continue
        if (Math.hypot(backXY[index * 2] - fromXY[index * 2], backXY[index * 2 + 1] - fromXY[index * 2 + 1]) > 1.5) continue
        if (Math.hypot(x - fromXY[index * 2], y - fromXY[index * 2 + 1]) > Math.min(width, height) * .16) continue
        from.push(features[index]); to.push({ x, y, group: features[index].group })
      }
      if (!spread(to)) return fail('features')
      const model = new jsfeat.matrix_t(3, 3, jsfeat.F32C1_t)
      const mask = new jsfeat.matrix_t(to.length, 1, jsfeat.U8C1_t)
      const estimator = new jsfeat.motion_model.homography2d()
      const params = new jsfeat.ransac_params_t(4, 2, .5, .99)
      if (!jsfeat.motion_estimator.ransac(params, estimator, from, to, to.length, model, mask, 150)) return fail('motion')
      const inliers = to.filter((_, index) => mask.data[index])
      if (!spread(inliers) || inliers.length < to.length * .6) return fail('motion')
      const matched = from.filter((_, index) => mask.data[index])
      if (!estimator.run(matched, inliers, model, inliers.length)) return fail('motion')
      const pixelCorners = currentCorners.map(point => ({ x: point.x * width, y: point.y * height }))
      const moved = pixelCorners.map(point => transformed(point, model.data))
      if (moved.some(point => point === null)) return fail('motion')
      const nextCorners = (moved as PhotoPoint[]).map(point => ({ x: point.x / width, y: point.y / height }))
      if (!validQuad(nextCorners) || nextCorners.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return fail('motion')
      const oldArea = quadArea(pixelCorners), newArea = quadArea(moved as PhotoPoint[])
      if (newArea / oldArea < .65 || newArea / oldArea > 1.5 ||
        nextCorners.some((point, index) => Math.hypot((point.x - currentCorners[index].x) * width, (point.y - currentCorners[index].y) * height) > Math.min(width, height) * .17)) return fail('motion')
      features = inliers
      previous = current
      currentCorners = nextCorners
      lastTimestamp = nextTimestamp
      return { status: 'tracked', corners: nextCorners.map(point => ({ ...point })), confidence: inliers.length / count }
    },
  }
}

function quadArea(points: PhotoPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % 4]
    return sum + point.x * next.y - next.x * point.y
  }, 0)) / 2
}
