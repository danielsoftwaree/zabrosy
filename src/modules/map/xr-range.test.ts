import { describe, expect, it } from 'vitest'
import { horizontalDistance, screenCentreRay, shoreHitEligible, stableXrTarget, viewerDirection, waterPlaneTarget } from './xr-range'

describe('tracked AR range geometry', () => {
  it('uses horizontal distance and the actual projected centre ray', () => {
    expect(horizontalDistance({ x: 0, y: 1.5, z: 0 }, { x: 3, y: -2, z: -4 })).toBe(5)
    const projection = new Float32Array(16)
    projection[0] = 2; projection[5] = 2; projection[8] = 0.4; projection[9] = -0.2
    const ray = screenCentreRay(projection)!
    expect(ray.x).toBeCloseTo(0.2)
    expect(ray.y).toBeCloseTo(-0.1)
    expect(ray.z).toBe(-1)
    expect(viewerDirection({ x: 0, y: 0, z: 0, w: 1 }, ray)).toMatchObject({ x: expect.closeTo(0.195, 2), y: expect.closeTo(-0.098, 2) })
    expect(screenCentreRay(new Float32Array(16))).toBeNull()
  })

  it('rotates the ray through compound viewer orientation', () => {
    const direction = viewerDirection({ x: 0.5, y: 0.5, z: -0.5, w: 0.5 })!
    expect(direction.x).toBeCloseTo(0)
    expect(direction.y).toBeCloseTo(1)
    expect(direction.z).toBeCloseTo(0)
  })

  it('intersects a confirmed water level, refusing bad or sensitive geometry', () => {
    const camera = { x: 0, y: 1.5, z: 0 }
    expect(waterPlaneTarget(camera, { x: 0, y: -0.3, z: -Math.sqrt(0.91) }, 0)?.z).toBeCloseTo(-4.77, 2)
    expect(waterPlaneTarget(camera, { x: 0, y: 0.1, z: -1 }, 0)).toBeNull()
    expect(waterPlaneTarget(camera, { x: 0, y: -0.03, z: -1 }, 0)).toBeNull()
    expect(waterPlaneTarget({ ...camera, y: 0.1 }, { x: 0, y: -0.3, z: -1 }, 0)).toBeNull()
    expect(waterPlaneTarget(camera, { x: 0, y: -0.1, z: -1 }, Number.NaN)).toBeNull()
    expect(shoreHitEligible(camera, { x: 0, y: 0, z: -2 })).toBe(true)
    expect(shoreHitEligible(camera, { x: 0, y: -10, z: -2 })).toBe(false)
    expect(shoreHitEligible(camera, { x: 0, y: 1.4, z: -2 })).toBe(false)
  })

  it('requires fresh multi-frame agreement in target, viewer, and aim', () => {
    const samples = [0, 100, 200, 300, 400, 500].map(at => ({
      at, camera: { x: 0, y: 1.5, z: 0 }, target: { x: at / 10000, y: 0, z: -8 },
      direction: { x: 0, y: -0.1, z: -0.995 },
    }))
    expect(stableXrTarget(samples, 550)?.target.x).toBe(0.05)
    expect(stableXrTarget(samples, 800)).toBeNull()
    expect(stableXrTarget(samples.slice(0, 3), 250)).toBeNull()
    expect(stableXrTarget(samples.map((sample, index) => ({ ...sample, target: { ...sample.target, x: index * 0.1 } })), 550)).toBeNull()
    expect(stableXrTarget(samples.map((sample, index) => ({ ...sample, direction: { ...sample.direction, x: index * 0.01 } })), 550)).toBeNull()
    expect(stableXrTarget(samples.map((sample, index) => ({ ...sample, at: index < 3 ? index * 100 : index * 100 + 250 })), 800)).toBeNull()
  })
})
