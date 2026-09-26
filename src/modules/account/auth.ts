import { z } from 'zod'
import { getBrowserSupabase } from './supabase.browser'

const loginResponse = z.object({
  username: z.string().min(2),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
})

function requireBrowserSupabase() {
  const client = getBrowserSupabase()
  if (!client) throw new Error('Облако пока не настроено.')
  return client
}

export async function signIn(username: string, password: string) {
  const client = requireBrowserSupabase()
  const { data, error } = await client.functions.invoke('marker-login', { body: { username, password } })
  if (error) {
    const body = error.context instanceof Response ? await error.context.json().catch(() => null) : null
    throw new Error(typeof body?.message === 'string' ? body.message : 'Не удалось войти. Повторите позже.')
  }
  const tokens = loginResponse.parse(data)
  const { error: sessionError } = await client.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token })
  if (sessionError) throw sessionError
  return tokens.username
}

export async function signOut() {
  const { error } = await requireBrowserSupabase().auth.signOut()
  if (error) throw error
}
