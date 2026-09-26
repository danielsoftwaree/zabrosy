import { listCloudCasts, listCloudSessions, saveCloudCast, saveCloudSession } from './cloud.browser'
import { castSchema, sessionSchema, getFieldData, loadFieldData, updateFieldData } from '../../shared/storage'
import type { Cast, Session } from '../../shared/model'
import { getBrowserSupabase } from './supabase.browser'
import { acknowledge, mergeCloud, type CloudSnapshot, type SyncConflict } from './sync-model'

let running: Promise<SyncConflict[]> | null = null
export function synchronize(): Promise<SyncConflict[]> {
  if (!running) running = sync().finally(() => { running = null })
  return running
}

async function sync(): Promise<SyncConflict[]> {
  const client = getBrowserSupabase()
  if (!client) throw new Error('Облако не настроено.')
  const { data: auth, error } = await client.auth.getUser()
  if (error || !auth.user) throw new Error('Войдите в аккаунт для синхронизации.')
  const ownerId = auth.user.id
  await loadFieldData()
  const remote: CloudSnapshot = { sessions: [], casts: [] }
  for (let offset = 0; ; offset += 200) {
    const rows = await listCloudSessions({ data: { offset, expectedOwnerId: ownerId } })
    for (const row of rows) {
      // Tombstones created by the client keep only identity. They never surface as content.
      const document = row.deleted_at ? { id: row.id, name: 'Удалённая рыбалка', createdAt: '', updatedAt: '' } as Session : sessionSchema.parse(row.document)
      remote.sessions.push({ id: row.id, document, revision: row.revision, deleted: Boolean(row.deleted_at) })
    }
    if (rows.length < 200) break
  }
  for (const session of remote.sessions) {
    for (let offset = 0; ; offset += 200) {
      const rows = await listCloudCasts({ data: { sessionId: session.id, offset, expectedOwnerId: ownerId } })
      for (const row of rows) {
        const document = row.deleted_at ? { id: row.id, sessionId: row.session_id, createdAt: '', updatedAt: '' } as Cast : castSchema.parse(row.document)
        if (!row.deleted_at && document.sessionId !== row.session_id) throw new Error('Облачный заброс относится к другой рыбалке.')
        remote.casts.push({ id: row.id, document, revision: row.revision, deleted: Boolean(row.deleted_at) })
      }
      if (rows.length < 200) break
    }
  }
  let conflicts: SyncConflict[] = []
  await updateFieldData(current => {
    const merged = mergeCloud(current, remote, ownerId)
    conflicts = merged.conflicts
    return merged.data
  })
  if (conflicts.length) return conflicts
  const snapshot = getFieldData()
  for (const session of snapshot.sessions) {
    const base = snapshot.sync.sessions[session.id]
    if (base?.syncedUpdatedAt === session.updatedAt) continue
    const result = await saveCloudSession({ data: { id: session.id, expectedOwnerId: ownerId, document: { ...session }, expectedRevision: base?.revision ?? 0, deleted: false } })
    if (result.status === 'conflict') throw new Error('Рыбалка изменена на другом устройстве. Повторите синхронизацию для выбора версии.')
    await updateFieldData(current => acknowledge(current, 'sessions', session.id, { revision: result.row.revision, syncedUpdatedAt: session.updatedAt }))
  }
  for (const cast of snapshot.casts) {
    const base = snapshot.sync.casts[cast.id]
    if (base?.syncedUpdatedAt === cast.updatedAt) continue
    const result = await saveCloudCast({ data: { id: cast.id, sessionId: cast.sessionId, expectedOwnerId: ownerId, document: { ...cast }, expectedRevision: base?.revision ?? 0, deleted: false } })
    if (result.status === 'conflict') throw new Error('Заброс изменён на другом устройстве. Повторите синхронизацию для выбора версии.')
    await updateFieldData(current => acknowledge(current, 'casts', cast.id, { revision: result.row.revision, syncedUpdatedAt: cast.updatedAt }, false, cast.sessionId))
  }
  for (const cast of snapshot.sync.deletedCasts) {
    const result = await saveCloudCast({ data: { id: cast.id, sessionId: cast.sessionId, expectedOwnerId: ownerId, document: { id: cast.id }, expectedRevision: snapshot.sync.casts[cast.id]?.revision ?? 0, deleted: true } })
    if (result.status === 'conflict') throw new Error('Удаляемый заброс изменён. Повторите синхронизацию.')
    await updateFieldData(current => acknowledge(current, 'casts', cast.id, { revision: result.row.revision, syncedUpdatedAt: '' }, true))
  }
  for (const id of snapshot.sync.deletedSessions) {
    const result = await saveCloudSession({ data: { id, expectedOwnerId: ownerId, document: { id }, expectedRevision: snapshot.sync.sessions[id]?.revision ?? 0, deleted: true } })
    if (result.status === 'conflict') throw new Error('Удаляемая рыбалка изменена. Повторите синхронизацию.')
    await updateFieldData(current => acknowledge(current, 'sessions', id, { revision: result.row.revision, syncedUpdatedAt: '' }, true))
  }
  return []
}
