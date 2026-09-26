import { describe, expect, it } from 'vitest'
import { addMark, bottom, calibrationFromInput, decimal, interrupt, lineLength, markLineLength, newDraft, newSession, repeatDraft, sameFrame, setTurns, skipFall, targetDirection, toCast, water } from './domain'

describe('survey', () => {
  it('takes a calibration snapshot and never treats fall time as depth', () => {
    const session = newSession(new Date('2026-01-01T00:00:00Z'))
    session.calibration = calibrationFromInput('40', '50', '')
    let draft = newDraft(session, 15, null)
    session.calibration.metersPerTurn = 1.2
    draft = water(draft, 1000)
    draft = bottom(draft, 3750)
    expect(draft.fallSeconds).toBe(2.75)
    draft = setTurns(draft, 10)
    draft = addMark(draft, 'gravel')
    draft = setTurns(draft, 50)
    const cast = toCast({ ...draft, stage: 'review' }, true, null, '')
    expect(lineLength(cast)).toBe(40)
    expect(markLineLength(cast, 10)).toBe(32)
    expect(cast.depth).toBeNull()
    expect(cast.calibration.metersPerTurn).toBe(.8)
  })

  it('interrupts uncertain fall and preserves observations on partial retrieval', () => {
    const session = newSession()
    let draft = interrupt(water(newDraft(session, -20, null), 0))
    expect(draft.stage).toBe('interrupted')
    expect(draft.fallSeconds).toBeNull()
    draft = skipFall(draft)
    draft = setTurns(draft, 5)
    draft = addMark(draft, 'weed')
    const cast = toCast({ ...draft, stage: 'review' }, false, null, '')
    expect(lineLength(cast)).toBeNull()
    expect(cast.marks).toHaveLength(1)
    expect(cast.fallInterrupted).toBe(true)
  })

  it('accepts decimal comma and prevents counter below a saved mark', () => {
    expect(decimal('2,5')).toBe(2.5)
    let draft = skipFall(newDraft(newSession(), 0, null))
    draft = addMark(setTurns(draft, 10), 'sand')
    expect(() => setTurns(draft, 9)).toThrow()
  })

  it('rejects a fall after the ten minute limit', () => {
    const draft = water(newDraft(newSession(), 0, null), 100)
    const stopped = bottom(draft, 600_101)
    expect(stopped.stage).toBe('interrupted')
    expect(stopped.fallSeconds).toBeNull()
  })

  it('separates casts when station or zero reference changed', () => {
    const station = newSession().station
    expect(sameFrame(station, { ...station, accuracyM: 25 })).toBe(true)
    expect(sameFrame(station, { ...station, referenceBearingDeg: 90 })).toBe(false)
    expect(sameFrame(station, { ...station, position: { lat: 53.3, lon: 14.6 } })).toBe(false)
  })

  it('derives a direction to the target only with a positioned station and known reference', () => {
    const session = newSession()
    const target = { lat: 53.001, lon: 14 }
    expect(targetDirection(session, target)).toBeNull()
    session.station = { position: { lat: 53, lon: 14 }, accuracyM: 5, referenceBearingDeg: 45 }
    expect(targetDirection(session, target)).toBeCloseTo(-45, 1)
  })

  it('repeats a cast with current calibration and clears old observations', () => {
    const session = newSession()
    session.station = { position: { lat: 53, lon: 14 }, accuracyM: 5, referenceBearingDeg: 10 }
    const target = { lat: 53.001, lon: 14.001 }
    let draft = skipFall(newDraft(session, 20, target))
    draft = addMark(setTurns(draft, 12), 'sand')
    const cast = toCast({ ...draft, stage: 'review' }, true, 2, 'previous', true)
    session.calibration = { ...session.calibration, metersPerTurn: 1.2 }
    const next = repeatDraft(cast, session)
    expect(next).toMatchObject({ stage: 'armed', directionDeg: 20, target, totalTurns: 0, marks: [], depth: null, fallSeconds: null, note: '', calibration: { metersPerTurn: 1.2 } })
    expect(next.id).not.toBe(cast.id)
    expect(next.target).not.toBe(cast.target)
    expect(() => repeatDraft(cast, { ...session, station: { ...session.station, referenceBearingDeg: 11 } })).toThrow()
    expect(() => repeatDraft(cast, { ...session, id: crypto.randomUUID() })).toThrow()
  })

  it('locates a manual depth only after explicit target confirmation', () => {
    const session = newSession()
    const target = { lat: 53, lon: 14 }
    const draft = { ...newDraft(session, 0, target), stage: 'review' as const }
    expect(toCast(draft, false, 3, '', false).depthPosition).toBeNull()
    expect(toCast(draft, false, 3, '', true).depthPosition).toEqual(target)
    expect(toCast(draft, false, null, '', true).depthPosition).toBeNull()
    expect(toCast({ ...draft, target: null }, false, 3, '', true).depthPosition).toBeNull()
  })
})
