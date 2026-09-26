import { describe, expect, it } from 'vitest'
import { emptyFieldData, type Cast, type FieldData, type Session } from '../../shared/model'
import { backupJson, castsCsv, mergeBackup, parseBackup, parseChartGeoJson, parseImportJson, parsePortableBackupHtml, removeCast, removeSession } from './data'

const sessionId = 'd83ae234-bcb1-40a5-a8bf-13cf8d16c25d'
const castId = '05bd1473-f2b9-42d6-a48d-21412299d45a'
const stamp = '2026-09-26T10:00:00.000Z'
const station = { position: null, accuracyM: null, referenceBearingDeg: null }
const calibration = { metersPerTurn: 0.8, source: 'estimate' as const, measuredLengthM: null, measuredTurns: null }
const session: Session = { id: sessionId, name: '=опасная формула', createdAt: stamp, updatedAt: stamp, station, calibration }
const cast: Cast = {
  id: castId, sessionId, createdAt: stamp, updatedAt: stamp, directionDeg: -15,
  station, calibration, target: null, fallSeconds: 2.5, fallInterrupted: false,
  totalTurns: 50, completeRetrieve: true, marks: [], depth: null,
  note: '+опасная заметка', favorite: false,
}

function field(): FieldData {
  return { ...structuredClone(emptyFieldData), sessions: [session], casts: [cast], activeSessionId: sessionId }
}

describe('journal data boundaries', () => {
  it('adds a backup as copies without overwriting an active draft or cloud metadata', () => {
    const current = field()
    const { updatedAt: _updatedAt, ...draftBase } = cast
    void _updatedAt
    current.draft = { ...draftBase, stage: 'retrieve', startedAt: null }
    current.sync.casts[castId] = { revision: 2, syncedUpdatedAt: stamp }
    const incoming = field()
    incoming.draft = { ...draftBase, id: '56b0dfaa-2596-433d-9b18-1cf7647c1abf', stage: 'falling', startedAt: 500 }
    const merged = mergeBackup(current, parseBackup(backupJson(incoming)))
    expect(merged.sessions).toHaveLength(2)
    expect(merged.casts).toHaveLength(2)
    expect(merged.sessions[1].id).not.toBe(sessionId)
    expect(merged.casts[1].sessionId).toBe(merged.sessions[1].id)
    expect(merged.draft).toEqual(current.draft)
    expect(merged.sync).toEqual(current.sync)
  })

  it('reads its own raw standalone HTML state without executing imported markup', () => {
    const raw = JSON.stringify(field())
    expect(parseImportJson(raw).data.sessions[0].id).toBe(sessionId)
    const source = `<script>globalThis.importedHtmlRan = true</script><script id="embedded-state" type="application/json">${raw}</script>`
    expect(parsePortableBackupHtml(source).data.casts[0].id).toBe(castId)
    expect((globalThis as typeof globalThis & { importedHtmlRan?: boolean }).importedHtmlRan).toBeUndefined()
    expect(() => parsePortableBackupHtml('<script id="embedded-state" type="application/json">null</script>')).toThrow()
  })

  it('restores a backed-up draft with new IDs and interrupts an uncertain fall', () => {
    const incoming = field()
    const { updatedAt: _updatedAt, ...draftBase } = cast
    void _updatedAt
    const markId = '4f8318eb-fd0b-4ca7-8771-935896ceffba'
    incoming.draft = { ...draftBase, marks: [{ id: markId, turns: 3, kind: 'weed', note: '' }], stage: 'falling', startedAt: 123, fallSeconds: 2.5 }
    const merged = mergeBackup(structuredClone(emptyFieldData), incoming)
    expect(merged.sessions).toHaveLength(1)
    expect(merged.draft?.id).not.toBe(castId)
    expect(merged.draft?.sessionId).toBe(merged.sessions[0].id)
    expect(merged.draft?.marks[0].id).not.toBe(markId)
    expect(merged.draft?.stage).toBe('interrupted')
    expect(merged.draft?.startedAt).toBeNull()
    expect(merged.draft?.fallSeconds).toBeNull()
    expect(merged.draft?.fallInterrupted).toBe(true)
    expect(merged.activeSessionId).toBe(merged.sessions[0].id)
  })

  it('rejects malformed JSON instead of replacing local records', () => {
    const backup = JSON.parse(backupJson(field())) as { data: { casts: Cast[] } }
    backup.data.casts[0].calibration.metersPerTurn = -1
    expect(() => parseBackup(JSON.stringify(backup))).toThrow()
    expect(() => parseBackup('{broken')).toThrow()
  })

  it('deletes synced children with tombstones and protects a live draft', () => {
    const data = field()
    data.sync.sessions[sessionId] = { revision: 1, syncedUpdatedAt: stamp }
    data.sync.casts[castId] = { revision: 1, syncedUpdatedAt: stamp }
    const { updatedAt: _updatedAt, ...draftBase } = cast
    void _updatedAt
    data.draft = { ...draftBase, id: 'd33e2212-c1e5-40d5-9bba-9efaf35e1489', stage: 'retrieve', startedAt: null }
    expect(() => removeSession(data, sessionId)).toThrow('активный промер')
    expect(() => removeCast(data, data.draft!.id)).toThrow('активный промер')
    data.draft = null
    const removed = removeSession(data, sessionId)
    expect(removed.sessions).toHaveLength(0)
    expect(removed.casts).toHaveLength(0)
    expect(removed.sync.deletedSessions).toEqual([sessionId])
    expect(removed.sync.deletedCasts).toEqual([{ id: castId, sessionId }])
    expect(removed.sync.sessions[sessionId].revision).toBe(1)
    expect(removed.sync.casts[castId].revision).toBe(1)
  })

  it('exports numeric line length separately and neutralizes CSV formulas in text', () => {
    const csv = castsCsv(field())
    expect(csv).toContain('"40"')
    expect(csv).toContain('"-15"')
    expect(csv).toContain('"\'=опасная формула"')
    expect(csv).toContain('"\'+опасная заметка"')
  })

  it('previews only georeferenced point depths with explicit metadata', () => {
    const metadata = { name: 'Измерения', source: 'Полевой файл', verticalDatum: 'Уровень воды 2026-09-26' }
    const valid = JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [14.6, 53.38] }, properties: { depthM: 2.4 },
    }] })
    expect(parseChartGeoJson(valid, metadata).points[0]).toEqual({ position: { lon: 14.6, lat: 53.38 }, depthM: 2.4 })
    expect(() => parseChartGeoJson(valid, { ...metadata, verticalDatum: '' })).toThrow('датум')
    expect(() => parseChartGeoJson(valid.replace('2.4', '"2.4"'), metadata)).toThrow('числовая глубина')
  })

  it('keeps an old v2 source intact and never invents historical depth, turns or coordinates', () => {
    const original = JSON.stringify({
      app: 'marker-mobile', schemaVersion: 2, title: 'Старая рыбалка', settings: { pickup: 0.8, geoAligned: false },
      casts: [
        { angle: 15, turns: 50, complete: true, method: 'reel', depth: 2.7, distance: 40,
          events: [{ type: 'tapping', turns: 10 }], notes: 'Ветер', createdAt: stamp },
        { angle: 20, distance: 35, notes: 'Нет оборотов' },
      ],
      draft: { phase: 'falling' },
    })
    const preview = parseImportJson(original)
    expect(preview.data.sessions).toHaveLength(1)
    expect(preview.data.casts).toHaveLength(1)
    expect(preview.data.casts[0].totalTurns).toBe(50)
    expect(preview.data.casts[0].depth).toBeNull()
    expect(preview.data.casts[0].station.position).toBeNull()
    expect(preview.data.draft).toBeNull()
    expect(preview.data.legacyBackups?.[0].source).toBe(original)
    expect(preview.warning).toContain('1 остались только в исходной копии')
  })
})

it('imports the JSON envelope emitted by its own export', () => {
  const data = field()
  expect(parseImportJson(backupJson(data)).data).toEqual(data)
})
