import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../../shared/ui'
import { useFieldStore } from '../../shared/storage'
import { dismissConflict, runSync, useSyncStatus } from './sync-status'
import { resolveConflict, type SyncConflict } from './sync-model'
import { getBrowserSupabase } from './supabase.browser'
import { signIn, signOut } from './auth'
import './account.css'

function profileName(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  return typeof user?.app_metadata?.marker_username === 'string' ? user.app_metadata.marker_username : null
}

export function AccountPanel() {
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const store = useFieldStore()
  const sync = useSyncStatus()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [userName, setUserName] = useState<string | null>(null)
  const [checking, setChecking] = useState(configured)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const supabase = getBrowserSupabase()
    if (!supabase) return
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserName(profileName(data.user))
    }).catch(() => {
      if (active) setUserName(null)
    }).finally(() => {
      if (active) setChecking(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUserName(profileName(session?.user))
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const name = await signIn(username.trim(), password)
      setPassword('')
      setUserName(name)
      setMessage('Вход выполнен.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось войти.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    setBusy(true)
    setMessage('')
    try {
      await signOut()
      setUserName(null)
      setPassword('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось выйти.')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    try {
      await store.update(current => ({ ...current, sync: { ...current.sync, enabled: true } }))
      await runSync()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось включить синхронизацию.') }
  }

  async function chooseVersion(conflict: SyncConflict, choice: 'local' | 'remote') {
    if (choice === 'remote' && !window.confirm('Принять облачную версию? Локальная версия этой записи будет заменена. Перед заменой можно сохранить JSON в журнале.')) return
    try {
      await store.update(current => resolveConflict(current, conflict, choice))
      dismissConflict(conflict.id)
      setMessage('Версия выбрана. Нажмите «Синхронизировать», чтобы передать изменения.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось выбрать версию.') }
  }

  return <section className="account-panel page" aria-labelledby="account-title">
    <h1 id="account-title">Аккаунт</h1>
    {!configured ? <p className="lede">Облачное сохранение пока недоступно. Можно продолжить без входа.</p>
      : checking ? <p className="lede">Проверяем вход…</p>
        : userName ? <div className="account-card">
          <p className="account-label">Выполнен вход</p>
          <strong>{userName}</strong>
          <p>Сохранённые рыбалки и забросы можно перенести между устройствами. Черновик и импортированные карты остаются на этом устройстве.</p>
          <Button type="button" disabled={busy || sync.busy || store.loading} onClick={syncNow}>{sync.busy ? 'Синхронизация…' : 'Синхронизировать'}</Button>{' '}
          <Button tone="quiet" type="button" disabled={busy || sync.busy} onClick={handleSignOut}>Выйти</Button>
        </div>
          : <div className="account-card">
            <p>Войдите с именем и общим паролем вашей группы. Сохранённые промеры можно перенести между устройствами.</p>
            <form onSubmit={submitLogin}>
              <label htmlFor="account-name">Имя пользователя</label>
              <input id="account-name" type="text" autoComplete="username" minLength={2} maxLength={32} required value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} />
              <label htmlFor="account-password">Общий пароль</label>
              <input id="account-password" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
              <Button type="submit" disabled={busy}>Войти</Button>
            </form>
          </div>}
    {userName && store.data.sync.enabled && <label className="sync-toggle"><input type="checkbox" checked onChange={() => { void store.update(current => ({ ...current, sync: { ...current.sync, enabled: false } })).catch(error => setMessage(String(error))) }} />Синхронизировать при изменениях и появлении сети</label>}
    {sync.lastSynced && <p className="muted">Последняя синхронизация: {new Date(sync.lastSynced).toLocaleString('ru')}</p>}
    {sync.error && <p role="alert">{sync.error} Локальные данные остаются на устройстве.</p>}
    {sync.conflicts.length > 0 && <section aria-label="Конфликты синхронизации"><h2>Выберите версию</h2><p>Записи менялись на двух устройствах. Автоматическая замена остановлена.</p>{sync.conflicts.map(conflict => <div className="sync-conflict" key={`${conflict.kind}-${conflict.id}`}>
      <strong>{conflict.title}</strong><p>На устройстве: {conflict.localDeleted ? 'удалено' : 'свои изменения'}. В облаке: {conflict.remote.deleted ? 'удалено' : 'другая версия'}.</p>
      <Button tone="quiet" disabled={sync.busy} onClick={() => chooseVersion(conflict, 'local')}>Оставить локальную</Button>{' '}
      <Button tone="quiet" disabled={sync.busy} onClick={() => chooseVersion(conflict, 'remote')}>Принять облачную</Button>
    </div>)}</section>}
    {message && <p className="account-message" role="status">{message}</p>}
  </section>
}
