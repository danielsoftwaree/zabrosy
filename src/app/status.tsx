import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useFieldStore } from '../shared/storage'
import { useSyncStatus } from '../modules/account/sync-status'

export function AppStatus() {
  const { data, loading, update } = useFieldStore()
  const sync = useSyncStatus()
  const [online, setOnline] = useState(true)
  const [offlineReady, setOfflineReady] = useState(false)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const connectivity = () => setOnline(navigator.onLine)
    connectivity()
    window.addEventListener('online', connectivity)
    window.addEventListener('offline', connectivity)
    return () => { window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity) }
  }, [])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    const inspect = () => { if (active && registration) setWaiting(registration.waiting) }
    void navigator.serviceWorker.ready.then(value => {
      registration = value
      if (active) { setOfflineReady(true); inspect(); registration.addEventListener('updatefound', inspect) }
    })
    const timer = window.setInterval(inspect, 15000)
    return () => { active = false; clearInterval(timer); registration?.removeEventListener('updatefound', inspect) }
  }, [])
  async function applyUpdate() {
    if (!waiting || data.draft) return
    try {
      await update(current => { if (current.draft) throw new Error('Сначала завершите промер.'); return current })
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
      waiting.postMessage('ACTIVATE_UPDATE')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось обновить приложение.') }
  }
  return <aside className="app-status" aria-label="Состояние приложения">
    {!online && <p role="status">Без сети · промеры сохраняются на устройстве</p>}
    {online && offlineReady && <span className="offline-ready">Доступно офлайн</span>}
    {waiting && <p role="status">Есть обновление. {data.draft ? 'Доступно после завершения промера.' : <button type="button" disabled={loading} onClick={applyUpdate}>Обновить</button>}</p>}
    {(sync.error || sync.conflicts.length > 0) && <p><Link to="/account">Синхронизация требует внимания</Link></p>}
    {error && <p role="alert">{error}</p>}
  </aside>
}
