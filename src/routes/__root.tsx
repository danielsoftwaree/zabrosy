import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, Outlet, HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { List } from '@phosphor-icons/react/dist/csr/List'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { Notebook } from '@phosphor-icons/react/dist/csr/Notebook'
import { Question } from '@phosphor-icons/react/dist/csr/Question'
import { Compass } from '@phosphor-icons/react/dist/csr/Compass'
import { UserCircle } from '@phosphor-icons/react/dist/csr/UserCircle'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { SyncManager } from '../modules/account/sync-status'
import { AppStatus } from '../app/status'
import { DesktopFrame } from '../app/desktop-frame'
import { ScreenAwake } from '../shared/platform/screen-awake'
import { Sheet } from '../shared/ui'
import { useFieldStore } from '../shared/storage'
import appStyles from '../app/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#18594a' },
      { title: 'Маркер — у воды' },
    ],
    links: [
      { rel: 'stylesheet', href: appStyles },
      { rel: 'manifest', href: `${import.meta.env.BASE_URL}manifest.webmanifest` },
      { rel: 'icon', href: `${import.meta.env.BASE_URL}icon-192.png`, type: 'image/png' },
      { rel: 'apple-touch-icon', href: `${import.meta.env.BASE_URL}icon-192.png` },
    ],
  }),
  component: Root,
})

const desktopQuery = '(min-width: 900px)'
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
function desktopSnapshot() {
  return window.self === window.top
    && new URLSearchParams(window.location.search).get('markerFrame') !== '1'
    && window.matchMedia(desktopQuery).matches
}

function Root() {
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => false)
  return <Document>{desktop ? <DesktopFrame /> : <MobileApp />}</Document>
}

function MobileApp() {
  const [menu, setMenu] = useState(false)
  const pathname = useRouterState({ select: state => state.location.pathname })
  const field = pathname === '/' || pathname === import.meta.env.BASE_URL
  const { data } = useFieldStore()
  const session = data.sessions.find(item => item.id === data.activeSessionId)
  const count = data.casts.filter(cast => cast.sessionId === session?.id).length
  return <div className={`app-shell${field ? ' app-shell--field' : ''}`}><SyncManager />
      <header className="app-header">
        {!field && <Link to="/" className="page-back" aria-label="Промер"><span className="circle"><ArrowLeft size={22} /></span><span>К промеру</span></Link>}
        <nav className="header-actions" aria-label="Основная навигация">
          <Link to="/journal" className="circle" aria-label="Журнал"><Notebook size={22} />{count > 0 && <span className="badge">{count}</span>}</Link>
          <button className="circle" aria-label="Меню и настройки" onClick={() => setMenu(true)}><List size={23} /></button>
        </nav>
      </header>
      <AppStatus />
      <main id="main" className="main"><Outlet /></main>
      <Sheet open={menu} onOpenChange={setMenu} title="У воды">
        <nav className="menu-links" aria-label="Разделы приложения" onClick={() => setMenu(false)}>
          <Link to="/journal"><Notebook size={23} /><span><strong>Журнал забросов</strong><small>Сессии, записи и резервные копии</small></span></Link>
          <Link to="/map"><MapTrifold size={23} /><span><strong>Карта участка</strong><small>Станция, ориентир и цель</small></span></Link>
          <Link to="/device"><Compass size={23} /><span><strong>Компас и GPS</strong><small>Доступ к датчикам и точность</small></span></Link>
          <Link to="/account"><UserCircle size={23} /><span><strong>Облачное сохранение</strong><small>Аккаунт и синхронизация</small></span></Link>
          <Link to="/help"><Question size={23} /><span><strong>Как пользоваться</strong><small>Памятка перед первым забросом</small></span></Link>
        </nav>
        <ScreenAwake />
        <p className="menu-note">Промеры сохраняются на этом устройстве. Резервные копии — в журнале.</p>
      </Sheet>
    </div>
}

function Document({ children }: { children: ReactNode }) {
  return <html lang="ru"><head><HeadContent /></head><body>{children}<Scripts /></body></html>
}
