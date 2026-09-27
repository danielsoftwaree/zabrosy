import { describe, expect, it } from 'vitest'
import { fromLocalMeters, localMeters } from './geometry'
import { photoProjection, validQuad } from './photo-geometry'

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
})
