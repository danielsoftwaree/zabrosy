import { createClient } from 'npm:@supabase/supabase-js@2'
import { accountIdentity, parseLoginBody, sharedPasswordMatches } from './identity.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}
function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return response(405, { message: 'Метод недоступен.' })

  const sharedPassword = Deno.env.get('MARKER_MVP_PASSWORD')
  const accountKey = Deno.env.get('MARKER_ACCOUNT_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!sharedPassword || !accountKey || accountKey.length < 32 || !url || !serviceKey || !anonKey) {
    return response(503, { message: 'Вход пока не настроен.' })
  }

  try {
    const raw = await request.text()
    if (raw.length > 2048) return response(413, { message: 'Слишком длинный запрос.' })
    const input = parseLoginBody(raw)
    if (!input) return response(400, { message: 'Проверьте имя пользователя и пароль.' })
    const { username, password } = input
    if (!await sharedPasswordMatches(password, sharedPassword)) return response(401, { message: 'Неверное имя пользователя или пароль.' })

    const identity = await accountIdentity(username, accountKey)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const admin = createClient(url, serviceKey, options)
    const auth = createClient(url, anonKey, options)
    let result = await auth.auth.signInWithPassword(identity)
    if (result.error) {
      // A failed sign-in can mean this username has not been provisioned yet.
      // If another request created it concurrently, retrying sign-in also works.
      await admin.auth.admin.createUser({
        email: identity.email,
        password: identity.password,
        email_confirm: true,
        app_metadata: { marker_username: username },
      })
      result = await auth.auth.signInWithPassword(identity)
    }
    if (result.error || !result.data.session) return response(503, { message: 'Не удалось войти. Повторите позже.' })
    return response(200, {
      username,
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
    })
  } catch {
    return response(503, { message: 'Не удалось войти. Повторите позже.' })
  }
})
