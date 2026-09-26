import { describe, expect, it } from 'vitest'
import { accountIdentity, normalizeUsername, parseLoginBody, sharedPasswordMatches } from '../../../supabase/functions/marker-login/identity'

describe('shared-password profile identity', () => {
  it('normalizes Unicode names and rejects unsafe or ambiguous input', () => {
    expect(normalizeUsername('  Ｆｏｏ_12  ')).toBe('foo_12')
    expect(normalizeUsername('  ТЕСТ-2  ')).toBe('тест-2')
    expect(normalizeUsername('a')).toBeNull()
    expect(normalizeUsername('name@example.com')).toBeNull()
    expect(normalizeUsername('name/path')).toBeNull()
  })

  it('derives stable private credentials without putting the username in the synthetic email', async () => {
    const key = 'a'.repeat(40)
    const first = await accountIdentity('тест-2', key)
    expect(first).toEqual(await accountIdentity('тест-2', key))
    expect(first.email).toMatch(/^[a-f0-9]{64}@users\.marker\.invalid$/)
    expect(first.email).not.toContain('тест')
    expect((await accountIdentity('тест-2', 'b'.repeat(40))).password).not.toBe(first.password)
    expect((await accountIdentity('other', key)).email).not.toBe(first.email)
  })

  it('checks the entire password digest', async () => {
    expect(await sharedPasswordMatches('group-secret', 'group-secret')).toBe(true)
    expect(await sharedPasswordMatches('group-secret ', 'group-secret')).toBe(false)
  })

  it('rejects malformed and oversized login fields before authentication', () => {
    expect(parseLoginBody('{')).toBeNull()
    expect(parseLoginBody('[]')).toBeNull()
    expect(parseLoginBody(JSON.stringify({ username: 'a', password: 'secret' }))).toBeNull()
    expect(parseLoginBody(JSON.stringify({ username: 'angler', password: 'x'.repeat(257) }))).toBeNull()
    expect(parseLoginBody(JSON.stringify({ username: ' Angler ', password: 'secret' }))).toEqual({ username: 'angler', password: 'secret' })
  })
})
