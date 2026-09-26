import { useEffect, useSyncExternalStore } from 'react'
import { useFieldStore } from '../../shared/storage'
import { getBrowserSupabase } from './supabase.browser'
import { synchronize } from './sync'
import type { SyncConflict } from './sync-model'

type State = { busy: boolean; error: string | null; conflicts: SyncConflict[]; lastSynced: string | null }
const initial: State = { busy: false, error: null, conflicts: [], lastSynced: null }
let state = initial
let rerunRequested = false
const listeners = new Set<() => void>()
function publish(next: State) { state = next; listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useSyncStatus() { return useSyncExternalStore(subscribe, () => state, () => initial) }
export function dismissConflict(id: string) { publish({ ...state, conflicts: state.conflicts.filter(conflict => conflict.id !== id) }) }
export async function runSync() {
  if (state.busy) { rerunRequested = true; return }
  publish({ ...state, busy: true, error: null })
  try {
    const conflicts = await synchronize()
    publish({ busy: false, error: null, conflicts, lastSynced: conflicts.length ? state.lastSynced : new Date().toISOString() })
  } catch (error) {
    publish({ ...state, busy: false, error: error instanceof Error ? error.message : 'Синхронизация не удалась. Локальные записи сохранены.' })
  } finally {
    const rerun = rerunRequested
    rerunRequested = false
    if (rerun && !state.error && !state.conflicts.length && navigator.onLine) queueMicrotask(() => { void runSync() })
  }
}

export function SyncManager() {
  const { data, loading } = useFieldStore()
  const enabled = !loading && Boolean(data.sync.enabled)
  const changes = JSON.stringify([data.sessions.map(row => [row.id, row.updatedAt]), data.casts.map(row => [row.id, row.updatedAt]), data.sync.deletedSessions, data.sync.deletedCasts])
  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => { if (navigator.onLine) void runSync() }, 1200)
    return () => window.clearTimeout(timer)
  }, [enabled, changes])
  useEffect(() => {
    if (!enabled) return
    const resume = () => { if (!document.hidden && navigator.onLine) void runSync() }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    const subscription = getBrowserSupabase()?.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') window.setTimeout(resume, 0) })
    return () => {
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
      subscription?.data.subscription.unsubscribe()
    }
  }, [enabled])
  return null
}
