import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'

export function ScreenAwake() {
  const lock = useRef<WakeLockSentinel | null>(null)
  const wanted = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  async function acquire() {
    if (!navigator.wakeLock) { setMessage('Браузер не поддерживает удержание экрана. Настройте автоблокировку телефона вручную.'); return }
    try {
      const next = await navigator.wakeLock.request('screen')
      if (!wanted.current || document.hidden) { await next.release(); return }
      lock.current = next
      setEnabled(true)
      setMessage('Экран остаётся включённым, пока приложение открыто.')
      next.addEventListener('release', () => { if (lock.current === next) { lock.current = null; setEnabled(false) } }, { once: true })
    } catch { setEnabled(false); setMessage('Не удалось удержать экран. Проверьте энергосбережение или настройте автоблокировку вручную.') }
  }
  useEffect(() => {
    const resume = () => { if (!document.hidden && wanted.current && !lock.current) void acquire() }
    document.addEventListener('visibilitychange', resume)
    return () => { wanted.current = false; document.removeEventListener('visibilitychange', resume); void lock.current?.release().catch(() => undefined) }
  }, [])
  return <div className="screen-awake"><Button tone="quiet" onClick={() => {
    if (wanted.current) { wanted.current = false; void lock.current?.release().catch(() => undefined); setEnabled(false); setMessage('Автоблокировка разрешена.') }
    else { wanted.current = true; void acquire() }
  }}>{enabled ? 'Разрешить блокировку экрана' : 'Держать экран включённым'}</Button>{message && <p role="status">{message}</p>}</div>
}
