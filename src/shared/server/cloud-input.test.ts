import { describe, expect, it } from 'vitest'
import { listSessionsInput, saveCastInput, saveSessionInput } from './cloud-input'

const id = 'd83ae234-bcb1-40a5-a8bf-13cf8d16c25d'
const otherId = '05bd1473-f2b9-42d6-a48d-21412299d45a'

describe('cloud input boundary', () => {
  it('accepts a first cast revision with matching IDs', () => {
    expect(saveCastInput.parse({
      id,
      expectedOwnerId: otherId,
      sessionId: otherId,
      expectedRevision: 0,
      document: { id, marks: [] },
    }).deleted).toBe(false)
  })

  it('rejects mismatched IDs and invalid revisions before a database call', () => {
    expect(saveSessionInput.safeParse({ id, expectedOwnerId: otherId, expectedRevision: -1, document: { id: otherId } }).success).toBe(false)
    expect(saveSessionInput.safeParse({ id, expectedOwnerId: otherId, expectedRevision: 0, document: { id: otherId } }).success).toBe(false)
  })

  it('rejects oversized or non-JSON documents', () => {
    expect(saveSessionInput.safeParse({ id, expectedOwnerId: otherId, expectedRevision: 0, document: { id, note: 'x'.repeat(1_000_000) } }).success).toBe(false)
    expect(saveSessionInput.safeParse({ id, expectedOwnerId: otherId, expectedRevision: 0, document: { id, invalid: Number.NaN } }).success).toBe(false)
  })

  it('requires the captured account identity on every list and save', () => {
    expect(listSessionsInput.safeParse({ offset: 0 }).success).toBe(false)
    expect(saveSessionInput.safeParse({ id, expectedRevision: 0, document: { id } }).success).toBe(false)
  })
})
