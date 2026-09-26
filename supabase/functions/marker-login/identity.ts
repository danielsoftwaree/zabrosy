const encoder = new TextEncoder()

export function normalizeUsername(value: string) {
  const username = value.trim().normalize('NFKC').toLowerCase()
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) return null
  return username
}

export function parseLoginBody(raw: string) {
  let values: unknown
  try { values = JSON.parse(raw) } catch { return null }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const fields = values as Record<string, unknown>
  const username = typeof fields.username === 'string' ? normalizeUsername(fields.username) : null
  const password = typeof fields.password === 'string' && fields.password.length <= 256 ? fields.password : null
  return username && password ? { username, password } : null
}

export async function accountIdentity(username: string, accountKey: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(username)))
  const email = `${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}@users.marker.invalid`
  const key = await crypto.subtle.importKey('raw', encoder.encode(accountKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`marker-account:v1:${username}`)))
  const password = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
  return { email, password }
}

export async function sharedPasswordMatches(input: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(input)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const a = new Uint8Array(left), b = new Uint8Array(right)
  let different = 0
  for (let index = 0; index < a.length; index++) different |= a[index] ^ b[index]
  return different === 0
}
