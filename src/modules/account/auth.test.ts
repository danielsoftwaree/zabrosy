import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }))
vi.mock('./supabase.browser', () => ({ getBrowserSupabase: () => ({
  functions: { invoke: mocks.invoke },
  auth: { setSession: mocks.setSession, signOut: mocks.signOut },
}) }))

import { signIn } from './auth'

describe('username login client', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.setSession.mockReset() })

  it('sets the returned Supabase session without exposing a synthetic email', async () => {
    mocks.invoke.mockResolvedValue({ data: { username: 'angler', access_token: 'access', refresh_token: 'refresh' }, error: null })
    mocks.setSession.mockResolvedValue({ error: null })
    await expect(signIn('Angler', 'shared-password')).resolves.toBe('angler')
    expect(mocks.invoke).toHaveBeenCalledWith('marker-login', { body: { username: 'Angler', password: 'shared-password' } })
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
  })

  it('surfaces the Edge function refusal and leaves the browser signed out', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ message: 'Неверное имя пользователя или пароль.' }), { status: 401 }) } })
    await expect(signIn('angler', 'wrong')).rejects.toThrow('Неверное имя пользователя или пароль.')
    expect(mocks.setSession).not.toHaveBeenCalled()
  })
})
