import { describe, expect, it } from 'vitest'
import type { Cast } from '../../shared/model'
import { observedDepths } from './bottom'

const base: Cast = {
  id: 'a', sessionId: 's', createdAt: '', updatedAt: '', directionDeg: 0,
  station: { position: null, accuracyM: null, referenceBearingDeg: null },
  calibration: { metersPerTurn: .8, source: 'estimate', measuredLengthM: null, measuredTurns: null },
  target: { lat: 53, lon: 14 }, fallSeconds: null, fallInterrupted: false,
  totalTurns: 0, completeRetrieve: false, marks: [], depth: null, note: '', favorite: false,
}

describe('bottom observations', () => {
  it('only draws depths with confirmed positions, never planned targets, fall time or chart-derived depth', () => {
    const casts: Cast[] = [
      { ...base, id: 'unknown', fallSeconds: 7 },
      { ...base, id: 'no-position', target: null, depth: { meters: 3, source: 'manual', observedAt: '' } },
      { ...base, id: 'planned-only', depth: { meters: 3, source: 'manual', observedAt: '' } },
      { ...base, id: 'chart', depthPosition: base.target, depth: { meters: 4, source: 'chart', observedAt: '' } },
      { ...base, id: 'measured', depthPosition: base.target, depth: { meters: 2.5, source: 'marker-float', observedAt: 'now' } },
    ]
    expect(observedDepths(casts)).toEqual([{ id: 'measured', position: { lat: 53, lon: 14 }, meters: 2.5, observedAt: 'now', source: 'marker-float' }])
  })
})
