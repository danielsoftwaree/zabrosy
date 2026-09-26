import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NavigationArrow } from '@phosphor-icons/react/dist/csr/NavigationArrow'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { Notebook } from '@phosphor-icons/react/dist/csr/Notebook'
import { FieldScreen } from './field-screen'
import { JournalPanel } from '../modules/journal'
import { emptyFieldData } from '../shared/model'
import { initializePortableStore, useFieldStore, validateFieldData } from '../shared/storage'
import './styles.css'

// This is the self-contained template, before React inserts any runtime DOM.
window.markerPortableTemplate = `<!doctype html>${document.documentElement.outerHTML}`
try {
  const value: unknown = JSON.parse(document.getElementById('embedded-state')?.textContent ?? 'null')
  initializePortableStore(value === null ? structuredClone(emptyFieldData) : validateFieldData(value))
  createRoot(document.getElementById('portable-root')!).render(<PortableApp />)
} catch {
  document.getElementById('portable-root')!.textContent = 'Не удалось прочитать данные копии. Исходный файл не изменён. Откройте предыдущую копию или импортируйте JSON в основное приложение.'
}
function PortableApp() {
  const [tab, setTab] = useState<'field' | 'journal'>('field')
  const { data } = useFieldStore()
  const session = data.sessions.find(item => item.id === data.activeSessionId)
  const count = data.casts.filter(cast => cast.sessionId === session?.id).length
  return <div className={`app-shell${tab === 'field' ? ' app-shell--field' : ''}`}>
    <header className="app-header">
      {tab === 'field' ? <div className="brand"><span className="brand-mark"><NavigationArrow size={23} /></span><span><strong>маркер</strong><small>{session?.name ?? 'Автономная копия'}</small></span></div>
        : <button className="page-back" type="button" aria-label="Промер" onClick={() => setTab('field')}><span className="circle"><ArrowLeft size={22} /></span><span>К промеру</span></button>}
      <nav className="header-actions" aria-label="Основная навигация"><button className="circle" type="button" aria-label="Журнал" onClick={() => setTab('journal')}><Notebook size={22} />{count > 0 && <span className="badge">{count}</span>}</button></nav>
    </header>
    {tab === 'journal' && <aside className="portable-note" role="status">Работа в памяти. Перед закрытием сохраните новую HTML-копию или JSON.</aside>}
    <main id="main" className="main">{tab === 'field' ? <FieldScreen /> : <JournalPanel onBack={() => setTab('field')} />}</main>
  </div>
}
