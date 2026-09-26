import type { Cast, FieldData, Session, SyncRecord } from '../../shared/model'

export type CloudRecord<T> = { id: string; document: T; revision: number; deleted: boolean }
export type CloudSnapshot = { sessions: CloudRecord<Session>[]; casts: CloudRecord<Cast>[] }
export type SyncConflict = { kind: 'sessions' | 'casts'; id: string; title: string; remote: CloudRecord<Session> | CloudRecord<Cast>; localDeleted: boolean }

function equalDocument(a: Session | Cast, b: Session | Cast): boolean {
  // PostgreSQL jsonb does not preserve the browser's object key order.
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, ordered(item)]))
      : value
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b))
}

// A changed local timestamp is an outbox entry. Ack stores exactly the timestamp
// sent, so an edit made while the request is in flight remains pending.
export function mergeCloud(local: FieldData, remote: CloudSnapshot, ownerId: string): { data: FieldData; conflicts: SyncConflict[] } {
  if (local.sync.ownerId && local.sync.ownerId !== ownerId) throw new Error('Эти локальные записи связаны с другим аккаунтом. Войдите в прежний аккаунт; автоматический перенос отключён.')
  const data = structuredClone(local)
  data.sync.ownerId = ownerId
  const conflicts: SyncConflict[] = []
  for (const kind of ['sessions', 'casts'] as const) {
    for (const row of remote[kind]) {
      const base = data.sync[kind][row.id]
      const record = data[kind].find(item => item.id === row.id)
      const deleted = kind === 'sessions' ? data.sync.deletedSessions.includes(row.id) : data.sync.deletedCasts.some(item => item.id === row.id)
      const dirty = deleted || Boolean(record && (!base || record.updatedAt !== base.syncedUpdatedAt))
      const remoteChanged = !base || base.revision !== row.revision
      if (!remoteChanged) continue
      const equal = record && !deleted && !row.deleted && equalDocument(record, row.document)
      const blocksDraft = kind === 'sessions' && row.deleted && data.draft?.sessionId === row.id
      // Session deletion cannot remove locally edited or newly created child casts.
      const dirtyChild = kind === 'sessions' && row.deleted && data.casts.some(cast => cast.sessionId === row.id && (!data.sync.casts[cast.id] || data.sync.casts[cast.id].syncedUpdatedAt !== cast.updatedAt))
      if (blocksDraft || dirtyChild || (dirty && !equal && !(deleted && row.deleted))) {
        conflicts.push({ kind, id: row.id, title: kind === 'sessions' ? (row.document as Session).name : row.deleted ? 'Удалённый заброс' : `Заброс ${new Date(row.document.createdAt).toLocaleString('ru')}`, remote: row, localDeleted: deleted })
        continue
      }
      applyRemote(data, kind, row)
    }
  }
  // Never keep orphaned casts, including records belonging to a remote tombstone.
  // A conflicting parent is retained above until the user resolves it.
  const ids = new Set(data.sessions.map(session => session.id))
  const deletedParents = new Set(remote.sessions.filter(row => row.deleted).map(row => row.id))
  for (const cast of data.casts) {
    if (!ids.has(cast.sessionId) && deletedParents.has(cast.sessionId) && data.sync.casts[cast.id] && !data.sync.deletedCasts.some(item => item.id === cast.id)) {
      data.sync.deletedCasts.push({ id: cast.id, sessionId: cast.sessionId })
    }
  }
  data.casts = data.casts.filter(cast => ids.has(cast.sessionId))
  if (!ids.has(data.activeSessionId ?? '')) data.activeSessionId = data.sessions[0]?.id ?? null
  return { data, conflicts }
}

function applyRemote(data: FieldData, kind: SyncConflict['kind'], row: SyncConflict['remote']) {
  if (kind === 'sessions') {
    data.sessions = data.sessions.filter(item => item.id !== row.id)
    if (!row.deleted) data.sessions.push(row.document as Session)
    data.sync.deletedSessions = data.sync.deletedSessions.filter(id => id !== row.id)
  } else {
    data.casts = data.casts.filter(item => item.id !== row.id)
    if (!row.deleted) data.casts.push(row.document as Cast)
    data.sync.deletedCasts = data.sync.deletedCasts.filter(item => item.id !== row.id)
  }
  data.sync[kind][row.id] = { revision: row.revision, syncedUpdatedAt: row.deleted ? '' : row.document.updatedAt }
}

export function resolveConflict(local: FieldData, conflict: SyncConflict, choice: 'local' | 'remote'): FieldData {
  const data = structuredClone(local)
  if (choice === 'remote') {
    if (conflict.kind === 'sessions' && data.draft?.sessionId === conflict.id) throw new Error('Сначала сохраните или отмените активный промер.')
    if (conflict.kind === 'sessions' && conflict.remote.deleted && data.casts.some(cast => cast.sessionId === conflict.id && (!data.sync.casts[cast.id] || data.sync.casts[cast.id].syncedUpdatedAt !== cast.updatedAt))) {
      throw new Error('В рыбалке есть непереданные изменения забросов. Сохраните копию и удалите их явно либо оставьте локальную версию рыбалки.')
    }
    if (conflict.kind === 'casts' && !conflict.remote.deleted && !data.sessions.some(session => session.id === (conflict.remote.document as Cast).sessionId)) {
      throw new Error('Сессия этого заброса удалена. Сначала восстановите её или оставьте локальное удаление заброса.')
    }
    applyRemote(data, conflict.kind, conflict.remote)
    if (conflict.kind === 'sessions' && conflict.remote.deleted) {
      data.casts = data.casts.filter(cast => cast.sessionId !== conflict.id)
      for (const cast of local.casts.filter(cast => cast.sessionId === conflict.id)) {
        if (data.sync.casts[cast.id] && !data.sync.deletedCasts.some(item => item.id === cast.id)) data.sync.deletedCasts.push({ id: cast.id, sessionId: conflict.id })
      }
      if (data.activeSessionId === conflict.id) data.activeSessionId = data.sessions[0]?.id ?? null
    }
  } else {
    // Advance the compared revision only; empty ack keeps the local edit dirty.
    data.sync[conflict.kind][conflict.id] = { revision: conflict.remote.revision, syncedUpdatedAt: '' }
    if (conflict.kind === 'casts' && !data.casts.some(cast => cast.id === conflict.id) && !data.sync.deletedCasts.some(item => item.id === conflict.id)) {
      data.sync.deletedCasts.push({ id: conflict.id, sessionId: (conflict.remote.document as Cast).sessionId })
    }
    if (conflict.kind === 'sessions' && !data.sessions.some(session => session.id === conflict.id) && !data.sync.deletedSessions.includes(conflict.id)) {
      data.sync.deletedSessions.push(conflict.id)
    }
  }
  return data
}

export function acknowledge(data: FieldData, kind: 'sessions' | 'casts', id: string, ack: SyncRecord, deleted = false, sessionId?: string): FieldData {
  const next = structuredClone(data)
  next.sync[kind][id] = ack
  if (deleted && kind === 'sessions') next.sync.deletedSessions = next.sync.deletedSessions.filter(item => item !== id)
  if (deleted && kind === 'casts') next.sync.deletedCasts = next.sync.deletedCasts.filter(item => item.id !== id)
  if (!deleted && kind === 'sessions' && !next.sessions.some(item => item.id === id) && !next.sync.deletedSessions.includes(id)) {
    // The session may have been deleted while its first upload was in flight.
    next.sync.deletedSessions.push(id)
  }
  if (!deleted && kind === 'casts' && !next.casts.some(item => item.id === id) && sessionId && !next.sync.deletedCasts.some(item => item.id === id)) {
    next.sync.deletedCasts.push({ id, sessionId })
  }
  return next
}
