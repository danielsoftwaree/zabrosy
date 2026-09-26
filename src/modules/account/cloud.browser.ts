import type { z } from 'zod'
import { listCastsInput, listSessionsInput, saveCastInput, saveSessionInput } from '../../shared/server/cloud-input'
import { getBrowserSupabase } from './supabase.browser'

type ListSessions = z.input<typeof listSessionsInput>
type ListCasts = z.input<typeof listCastsInput>
type SaveSession = z.input<typeof saveSessionInput>
type SaveCast = z.input<typeof saveCastInput>

async function verifiedClient(expectedOwnerId: string) {
  const client = getBrowserSupabase()
  if (!client) throw new Error('Облако не настроено.')
  const { data, error } = await client.auth.getUser()
  if (error || !data.user || data.user.id !== expectedOwnerId) throw new Error('Аккаунт изменился. Войдите снова перед синхронизацией.')
  if (typeof data.user.app_metadata?.marker_username !== 'string') throw new Error('Этот профиль не имеет доступа к облаку маркера.')
  return { client, ownerId: data.user.id }
}

export async function listCloudSessions({ data }: { data: ListSessions }) {
  const input = listSessionsInput.parse(data)
  const { client, ownerId } = await verifiedClient(input.expectedOwnerId)
  const { data: rows, error } = await client.from('survey_sessions')
    .select('id, document, revision, updated_at, deleted_at')
    .eq('owner_id', ownerId).order('updated_at').order('id')
    .range(input.offset, input.offset + 199)
  if (error) throw error
  return rows
}

export async function listCloudCasts({ data }: { data: ListCasts }) {
  const input = listCastsInput.parse(data)
  const { client, ownerId } = await verifiedClient(input.expectedOwnerId)
  const { data: rows, error } = await client.from('survey_casts')
    .select('id, session_id, document, revision, updated_at, deleted_at')
    .eq('owner_id', ownerId).eq('session_id', input.sessionId)
    .order('updated_at').order('id').range(input.offset, input.offset + 199)
  if (error) throw error
  return rows
}

export async function saveCloudSession({ data }: { data: SaveSession }) {
  const input = saveSessionInput.parse(data)
  const { client, ownerId } = await verifiedClient(input.expectedOwnerId)
  const deletedAt = input.deleted ? new Date().toISOString() : null
  if (input.expectedRevision === 0) {
    const { data: row, error } = await client.from('survey_sessions')
      .insert({ id: input.id, owner_id: ownerId, document: input.document, revision: 1, deleted_at: deletedAt })
      .select('id, revision, updated_at').single()
    if (error?.code === '23505') return { status: 'conflict' as const }
    if (error) throw error
    return { status: 'saved' as const, row }
  }
  const { data: row, error } = await client.from('survey_sessions')
    .update({ document: input.document, revision: input.expectedRevision + 1, deleted_at: deletedAt })
    .eq('owner_id', ownerId).eq('id', input.id).eq('revision', input.expectedRevision)
    .select('id, revision, updated_at').maybeSingle()
  if (error) throw error
  return row ? { status: 'saved' as const, row } : { status: 'conflict' as const }
}

export async function saveCloudCast({ data }: { data: SaveCast }) {
  const input = saveCastInput.parse(data)
  const { client, ownerId } = await verifiedClient(input.expectedOwnerId)
  const deletedAt = input.deleted ? new Date().toISOString() : null
  if (input.expectedRevision === 0) {
    const { data: row, error } = await client.from('survey_casts')
      .insert({ id: input.id, owner_id: ownerId, session_id: input.sessionId, document: input.document, revision: 1, deleted_at: deletedAt })
      .select('id, revision, updated_at').single()
    if (error?.code === '23505') return { status: 'conflict' as const }
    if (error) throw error
    return { status: 'saved' as const, row }
  }
  const { data: row, error } = await client.from('survey_casts')
    .update({ document: input.document, revision: input.expectedRevision + 1, deleted_at: deletedAt })
    .eq('owner_id', ownerId).eq('id', input.id).eq('session_id', input.sessionId).eq('revision', input.expectedRevision)
    .select('id, revision, updated_at').maybeSingle()
  if (error) throw error
  return row ? { status: 'saved' as const, row } : { status: 'conflict' as const }
}
