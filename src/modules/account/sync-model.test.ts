import { describe, expect, it } from 'vitest'
import { emptyFieldData, type Cast, type FieldData, type Session } from '../../shared/model'
import { acknowledge, mergeCloud, resolveConflict } from './sync-model'

const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const sessionId = '00000000-0000-4000-8000-000000000003'
const castId = '00000000-0000-4000-8000-000000000004'
const at = '2026-01-01T00:00:00.000Z'
const session: Session = { id: sessionId, name: 'Берег', createdAt: at, updatedAt: at, station: { position: null, accuracyM: null, referenceBearingDeg: null }, calibration: { metersPerTurn: .8, source: 'estimate', measuredLengthM: null, measuredTurns: null } }
const cast: Cast = { id: castId, sessionId, createdAt: at, updatedAt: at, directionDeg: 0, station: session.station, calibration: session.calibration, target: null, fallSeconds: null, fallInterrupted: false, totalTurns: 0, completeRetrieve: false, marks: [], depth: null, note: '', favorite: false }

function local(): FieldData { return { ...structuredClone(emptyFieldData), sessions: [session], casts: [cast], activeSessionId: sessionId } }

describe('cloud merge and acknowledgement', () => {
  it('refuses to merge a second account into a device bound to the first', () => {
    const data = local()
    data.sync.ownerId = owner
    expect(() => mergeCloud(data, { sessions: [], casts: [] }, other)).toThrow('другим аккаунтом')
    expect(data.sessions).toHaveLength(1)
  })

  it('queues a tombstone if a session is removed during its first cloud upload', () => {
    const data = local()
    data.sessions = []
    data.casts = []
    data.activeSessionId = null
    const result = acknowledge(data, 'sessions', sessionId, { revision: 1, syncedUpdatedAt: at })
    expect(result.sync.deletedSessions).toEqual([sessionId])
    expect(result.sync.sessions[sessionId].revision).toBe(1)
  })

  it('queues a cast tombstone with its parent id if removed during first upload', () => {
    const data = local()
    data.casts = []
    const result = acknowledge(data, 'casts', castId, { revision: 1, syncedUpdatedAt: at }, false, sessionId)
    expect(result.sync.deletedCasts).toEqual([{ id: castId, sessionId }])
    expect(result.sync.casts[castId].revision).toBe(1)
  })

  it('stops a remote parent tombstone from dropping an unsynced child', () => {
    const data = local()
    data.sync.ownerId = owner
    data.sync.sessions[sessionId] = { revision: 1, syncedUpdatedAt: at }
    const result = mergeCloud(data, { sessions: [{ id: sessionId, document: session, revision: 2, deleted: true }], casts: [] }, owner)
    expect(result.conflicts).toHaveLength(1)
    expect(result.data.sessions).toHaveLength(1)
    expect(result.data.casts).toHaveLength(1)
  })

  it('recognizes an identical JSONB document even when object keys are reordered', () => {
    const reordered = Object.fromEntries(Object.entries(session).reverse()) as Session
    const result = mergeCloud(local(), { sessions: [{ id: sessionId, document: reordered, revision: 1, deleted: false }], casts: [] }, owner)
    expect(result.conflicts).toEqual([])
    expect(result.data.sync.sessions[sessionId].revision).toBe(1)
  })

  it('queues child deletion when a remote parent tombstone removes a synced session', () => {
    const data = local()
    data.sync.ownerId = owner
    data.sync.sessions[sessionId] = { revision: 1, syncedUpdatedAt: at }
    data.sync.casts[castId] = { revision: 1, syncedUpdatedAt: at }
    const result = mergeCloud(data, {
      sessions: [{ id: sessionId, document: session, revision: 2, deleted: true }],
      casts: [{ id: castId, document: cast, revision: 1, deleted: false }],
    }, owner)
    expect(result.conflicts).toEqual([])
    expect(result.data.sessions).toHaveLength(0)
    expect(result.data.casts).toHaveLength(0)
    expect(result.data.sync.deletedCasts).toEqual([{ id: castId, sessionId }])
  })

  it('rejects a remote parent deletion while an unsynced child would be lost', () => {
    const data = local()
    data.sync.ownerId = owner
    data.sync.sessions[sessionId] = { revision: 1, syncedUpdatedAt: at }
    data.sync.casts[castId] = { revision: 1, syncedUpdatedAt: '' }
    const result = mergeCloud(data, { sessions: [{ id: sessionId, document: session, revision: 2, deleted: true }], casts: [] }, owner)
    expect(() => resolveConflict(result.data, result.conflicts[0], 'remote')).toThrow('непереданные изменения')
    expect(result.data.casts).toHaveLength(1)
  })
})
