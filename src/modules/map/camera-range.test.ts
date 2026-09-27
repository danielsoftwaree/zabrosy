import { describe, expect, it } from 'vitest'
import { calibratePitch, estimateWaterRange, rearCameraDepression, stablePitch } from './camera-range'

describe('rear camera water-range geometry', () => {
  it('projects the rear optical axis independent of screen rotation and alpha', () => {
    expect(rearCameraDepression(90, 0)).toBeCloseTo(0)
    expect(rearCameraDepression(80, 0)).toBeCloseTo(10)
    expect(rearCameraDepression(100, 0)).toBeCloseTo(-10)
    expect(rearCameraDepression(90, 90)).toBeCloseTo(0)
    expect(rearCameraDepression(0, 90)).toBeCloseTo(0)
    expect(rearCameraDepression(null, 0)).toBeNull()
  })

  it('requires a fresh, steady aim for calibration and capture', () => {
    const samples = [0, 100, 200, 300, 400, 500].map(at => ({ at, depressionDeg: 10 + at / 2000 }))
    expect(stablePitch(samples, 550)).toMatchObject({ ready: true, depressionDeg: 10.15 })
    expect(stablePitch(samples, 1100)).toEqual({ ready: false, reason: 'stale' })
    expect(stablePitch(samples.slice(0, 2), 150)).toEqual({ ready: false, reason: 'waiting' })
    expect(stablePitch(samples.map((sample, index) => ({ ...sample, depressionDeg: sample.depressionDeg + index })), 550))
      .toEqual({ ready: false, reason: 'moving' })
  })

  it('calibrates horizon and a known water-level distance separately', () => {
    const horizon = calibratePitch(3, 1.5, 'horizon', 100)
    expect(horizon?.offsetDeg).toBe(3)
    const known = calibratePitch(10, 1.5, 'known-distance', 100, 20)
    expect(known?.offsetDeg).toBeCloseTo(10 - Math.atan(1.5 / 20) * 180 / Math.PI)
    expect(calibratePitch(10, 1.5, 'known-distance', 100, 0)).toBeNull()
  })

  it('returns an explicit sensitivity range, refusing near-horizon geometry', () => {
    const calibration = calibratePitch(0, 1.5, 'horizon', 100)!
    const estimate = estimateWaterRange({ rawDepressionDeg: 10, spreadDeg: 0, heightM: 1.5, heightToleranceM: 0.1, calibration })
    expect(estimate.valid).toBe(true)
    if (estimate.valid) {
      expect(estimate.distanceM).toBeCloseTo(8.507, 2)
      expect(estimate.lowerM).toBeLessThan(estimate.distanceM)
      expect(estimate.upperM).toBeGreaterThan(estimate.distanceM)
      expect(estimate.angleToleranceDeg).toBe(2)
    }
    expect(estimateWaterRange({ rawDepressionDeg: 2.5, spreadDeg: 0, heightM: 1.5, heightToleranceM: 0.1, calibration }))
      .toEqual({ valid: false, reason: 'near-horizon' })
    expect(estimateWaterRange({ rawDepressionDeg: 0, spreadDeg: 0, heightM: 1.5, heightToleranceM: 0.1, calibration }))
      .toEqual({ valid: false, reason: 'near-horizon' })
    expect(estimateWaterRange({ rawDepressionDeg: -1, spreadDeg: 0, heightM: 1.5, heightToleranceM: 0.1, calibration }))
      .toEqual({ valid: false, reason: 'above-water' })
  })
})
