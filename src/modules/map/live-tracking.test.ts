import { describe, expect, it } from 'vitest'
import { createLiveTracker } from './live-tracking'
import type { PhotoPoint } from './photo-geometry'

const width = 320, height = 240
const corners: PhotoPoint[] = [
  { x: .18, y: .69 }, { x: .82, y: .69 }, { x: .82, y: .31 }, { x: .18, y: .31 },
]

function shoreline(): Uint8Array {
  const pixels = new Uint8Array(width * height).fill(110)
  let random = 1417
  const rand = () => { random = (Math.imul(random, 1664525) + 1013904223) | 0; return (random >>> 0) / 2 ** 32 }
  for (let index = 0; index < 230; index++) {
    const x = 12 + Math.floor(rand() * (width - 24))
    const y = index % 2 ? 12 + Math.floor(rand() * 48) : height - 60 + Math.floor(rand() * 48)
    const size = 3 + Math.floor(rand() * 5)
    const shade = 30 + Math.floor(rand() * 190)
    for (let py = Math.max(0, y - size); py <= Math.min(height - 1, y + size); py++) {
      for (let px = Math.max(0, x - size); px <= Math.min(width - 1, x + size); px++) {
        if ((px - x) ** 2 + (py - y) ** 2 <= size ** 2) pixels[py * width + px] = shade
      }
    }
  }
  return pixels
}

function frame(source: Uint8Array, shiftX = 0, shiftY = 0, angle = 0): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4)
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - width / 2 - shiftX, dy = y - height / 2 - shiftY
    const sourceX = Math.round(width / 2 + cosine * dx + sine * dy)
    const sourceY = Math.round(height / 2 - sine * dx + cosine * dy)
    const value = sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height ? source[sourceY * width + sourceX] : 110
    const offset = (y * width + x) * 4
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return { width, height, data: rgba } as ImageData
}

function perspectiveFrame(source: Uint8Array): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4)
  const k = .00025, dx = 3, dy = -2
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceY = (y * (1 - k * height / 2) - dy) / (1 - y * k)
    const sourceX = x * (1 + k * (sourceY - height / 2)) - dx
    const ix = Math.round(sourceX), iy = Math.round(sourceY)
    const value = ix >= 0 && ix < width && iy >= 0 && iy < height ? source[iy * width + ix] : 110
    const offset = (y * width + x) * 4
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return { width, height, data: rgba } as ImageData
}

describe('live shoreline tracking', () => {
  it('follows a translated and rotated camera frame', () => {
    const source = shoreline()
    const tracker = createLiveTracker(corners, frame(source), 0)
    expect(tracker).not.toBeNull()
    const translated = tracker!.update(frame(source, 4, -3), 100)
    expect(translated.status).toBe('tracked')
    if (translated.status !== 'tracked') return
    expect(translated.corners[0].x).toBeCloseTo(corners[0].x + 4 / width, 2)
    expect(translated.corners[0].y).toBeCloseTo(corners[0].y - 3 / height, 2)
    expect(translated.confidence).toBeGreaterThan(.5)
    const rotated = tracker!.update(frame(source, 5, -3, .018), 200)
    expect(rotated.status).toBe('tracked')
    if (rotated.status !== 'tracked') return
    expect(rotated.corners[0].x).toBeGreaterThan(translated.corners[0].x - .01)
    expect(rotated.corners[0].x).toBeLessThan(translated.corners[0].x + .02)
  })

  it('loses registration on blank image, frame gap, or size change', () => {
    const source = shoreline(), first = frame(source)
    expect(createLiveTracker(corners, frame(new Uint8Array(width * height).fill(110)), 0)).toBeNull()
    const waterOnly = new Uint8Array(width * height).fill(110)
    for (let y = 86; y < 154; y++) for (let x = 0; x < width; x++) waterOnly[y * width + x] = ((x * 13 + y * 19) % 37) * 6
    expect(createLiveTracker(corners, frame(waterOnly), 0)).toBeNull()
    const lost = createLiveTracker(corners, first, 0)!
    expect(lost.update(frame(new Uint8Array(width * height).fill(110)), 100).status).toBe('lost')
    expect(lost.update(first, 200).status).toBe('lost')
    expect(createLiveTracker(corners, first, 0)!.update(first, 800)).toEqual({ status: 'lost', reason: 'gap' })
    expect(createLiveTracker(corners, first, 0)!.update({ ...first, width: width - 1 } as ImageData, 100)).toEqual({ status: 'lost', reason: 'frame' })
  })

  it('follows modest perspective motion across both shorelines', () => {
    const source = shoreline()
    const tracker = createLiveTracker(corners, frame(source), 0)!
    const result = tracker.update(perspectiveFrame(source), 100)
    expect(result.status).toBe('tracked')
    if (result.status !== 'tracked') return
    for (let index = 0; index < 4; index++) {
      const point = corners[index]
      const denominator = 1 + .00025 * (point.y * height - height / 2)
      expect(Math.abs(result.corners[index].x - (point.x * width + 3) / denominator / width)).toBeLessThan(.012)
      expect(Math.abs(result.corners[index].y - (point.y * height - 2) / denominator / height)).toBeLessThan(.012)
    }
  })
})
