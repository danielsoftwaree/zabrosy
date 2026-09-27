import { describe, expect, it } from 'vitest'
import { fromLocalMeters, localMeters } from './geometry'
import { photoDistanceRings, photoProjection, photoRegistration, validQuad } from './photo-geometry'

describe('water-plane photo registration', () => {
  const origin = { lat: 53.38668, lon: 14.61904 }
  const anchors = [[-10, 10], [10, 10], [10, 100], [-10, 100]].map(([e, n]) => fromLocalMeters(origin, e, n))
  // Pinhole view: x=.5+east/north*.2, y=.2+3/north.
  const image = [{ x: .3, y: .5 }, { x: .7, y: .5 }, { x: .52, y: .23 }, { x: .48, y: .23 }]
  it('recovers a 60 m point from perspective instead of linear pixel interpolation', () => {
    const project = photoProjection(image, anchors)!
    const mapped = localMeters(origin, project({ x: .5, y: .25 })!)
    expect(mapped.east).toBeCloseTo(0, 5)
    expect(mapped.north).toBeCloseTo(60, 5)
    anchors.forEach((anchor, i) => expect(project(image[i])?.lat).toBeCloseTo(anchor.lat, 8))
    expect(project({ x: .5, y: .1 })).toBeNull()
  })
  it('rejects crossed, thin, coincident or invalid control points', () => {
    expect(validQuad([image[0], image[2], image[1], image[3]])).toBe(false)
    expect(photoProjection(image, anchors.map(() => origin))).toBeNull()
    expect(photoProjection(image.map(p => ({ ...p, y: .5 })), anchors)).toBeNull()
    expect(photoProjection([{ x: NaN, y: .5 }, ...image.slice(1)], anchors)).toBeNull()
  })
  it('projects map coordinates back into the perspective image, including rotated control points', () => {
    const rotatedImage = [image[1], image[2], image[3], image[0]]
    const rotatedAnchors = [anchors[1], anchors[2], anchors[3], anchors[0]]
    const registration = photoRegistration(rotatedImage, rotatedAnchors)!
    const mapped = fromLocalMeters(origin, 5, 60)
    const pixel = registration.toImage(mapped)!
    expect(pixel.x).toBeCloseTo(.5 + 5 / 60 * .2, 7)
    expect(pixel.y).toBeCloseTo(.25, 7)
    const roundTrip = localMeters(origin, registration.toWorld(pixel)!)
    expect(roundTrip.east).toBeCloseTo(5, 5)
    expect(roundTrip.north).toBeCloseTo(60, 5)
    rotatedAnchors.forEach((anchor, i) => {
      expect(registration.toImage(anchor)?.x).toBeCloseTo(rotatedImage[i].x, 7)
      expect(registration.toImage(anchor)?.y).toBeCloseTo(rotatedImage[i].y, 7)
    })
    expect(registration.toImage(fromLocalMeters(origin, 0, 110))).toBeNull()
    expect(registration.toImage({ lat: NaN, lon: origin.lon })).toBeNull()
  })
  it('clips bounded distance rings to the registered water quad', () => {
    const rings = photoDistanceRings(image, anchors, origin, 20)
    expect(rings.map(ring => ring.meters)).toEqual([20, 40, 60, 80, 100])
    const project = photoProjection(image, anchors)!
    for (const ring of rings) for (const segment of ring.segments) for (const pixel of segment) {
      const position = project(pixel)
      expect(position).not.toBeNull()
      const local = localMeters(origin, position!)
      expect(Math.hypot(local.east, local.north)).toBeCloseTo(ring.meters, 0)
    }
    expect(rings.some(ring => ring.segments.some(([from, to]) => [from, to].some(point => {
      const local = localMeters(origin, project(point)!)
      return Math.abs(Math.abs(local.east) - 10) < 1e-5
    })))).toBe(true)
    expect(photoDistanceRings(image, anchors, { lat: NaN, lon: origin.lon })).toEqual([])
    expect(photoDistanceRings(image, anchors, origin, 0)).toEqual([])
  })
})
