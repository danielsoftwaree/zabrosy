import { useState, type ChangeEvent, type FormEvent } from 'react'
import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple'
import { Star } from '@phosphor-icons/react/dist/icons/Star'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { UploadSimple } from '@phosphor-icons/react/dist/icons/UploadSimple'
import { Button, Sheet } from '../../shared/ui'
import { bottomLabels, defaultCalibration, type BottomKind, type Cast, type ChartDataset, type Depth, type FieldData, type Session } from '../../shared/model'
import { useFieldStore } from '../../shared/storage'
import { downloadPortable } from '../../shared/lib/portable'
import { repeatDraft } from '../survey'
import { backupJson, castsCsv, mergeBackup, parseChartGeoJson, parseImportJson, parsePortableBackupHtml, removeCast, removeSession } from './data'
import './journal.css'

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function nextTimestamp(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
}

function friendlyError(error: unknown) {
  if (error instanceof Error && error.name === 'ZodError') return 'Данные не прошли проверку. Проверьте формат файла и значения. Существующие записи не изменены.'
  return error instanceof Error ? error.message : 'Операция не выполнена.'
}

function chartRange(chart: ChartDataset) {
  let min = Infinity
  let max = -Infinity
  for (const point of chart.points) {
    min = Math.min(min, point.depthM)
    max = Math.max(max, point.depthM)
  }
  return `${min}–${max} м`
}

type Action = (fn: (current: FieldData) => FieldData) => Promise<void>

const markColors: Record<BottomKind, string> = {
  silt: '#9c7ab4', sand: '#218578', gravel: '#cc8e36', shell: '#5679b1', weed: '#779243', edge: '#c8604d',
}

function CastCard({ cast, number, session, update, onError }: { cast: Cast; number: number; session: Session; update: Action; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  const line = cast.completeRetrieve ? cast.totalTurns * cast.calibration.metersPerTurn : null

  async function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const note = String(form.get('note') ?? '').trim()
    const rawDepth = String(form.get('depth') ?? '').trim().replace(',', '.')
    const meters = rawDepth === '' ? null : Number(rawDepth)
    if (meters !== null && (!Number.isFinite(meters) || meters < 0 || meters > 10_000)) {
      onError('Глубина должна быть числом от 0 до 10 000 м.')
      return
    }
    const totalTurns = Number(form.get('totalTurns'))
    const completeRetrieve = form.get('completeRetrieve') === 'on'
    if (!Number.isFinite(totalTurns) || totalTurns < 0 || totalTurns > 10_000 || (completeRetrieve && totalTurns === 0)) {
      onError('Обороты должны быть от 0 до 10 000; полная подмотка требует хотя бы одного оборота.')
      return
    }
    let invalidMark = false
    const marks = cast.marks.map((mark) => {
      const turns = Number(form.get(`mark-${mark.id}-turns`))
      const kind = String(form.get(`mark-${mark.id}-kind`) ?? '') as BottomKind
      const note = String(form.get(`mark-${mark.id}-note`) ?? '').trim()
      if (!Number.isFinite(turns) || turns < 0 || turns > totalTurns || !Object.hasOwn(bottomLabels, kind) || note.length > 10_000) invalidMark = true
      return { ...mark, turns, kind, note }
    })
    if (invalidMark) { onError('Отметки должны быть в пределах подмотки; проверьте тип и заметку.'); return }
    const source = String(form.get('source') ?? 'manual') as Depth['source']
    const depthPosition = meters === null ? null : cast.target
      ? form.get('depthPosition') === 'on' ? cast.target : null
      : cast.depthPosition ?? null
    setBusy(true)
    try {
      await update((current) => ({
        ...current,
        casts: current.casts.map((item) => item.id === cast.id ? {
          ...item, note, totalTurns, completeRetrieve, marks, depthPosition, updatedAt: nextTimestamp(item.updatedAt),
          depth: meters === null ? null : { meters, source, observedAt: new Date().toISOString() },
        } : item),
      }))
      onError('Изменения сохранены на устройстве.')
    } catch (error) { onError(friendlyError(error)) }
    finally { setBusy(false) }
  }

  async function repeat() {
    setBusy(true)
    try {
      await update((current) => {
        if (current.draft) throw new Error('Сначала завершите текущий промер.')
        const selected = current.sessions.find((item) => item.id === session.id)
        const source = current.casts.find((item) => item.id === cast.id)
        if (!selected || !source) throw new Error('Заброс или сессия больше не существуют.')
        return { ...current, activeSessionId: selected.id, draft: repeatDraft(source, selected) }
      })
      onError('Черновик повтора готов. Откройте «Промер».')
    } catch (error) { onError(friendlyError(error)) }
    finally { setBusy(false) }
  }

  async function toggleFavorite() {
    setBusy(true)
    try {
      await update((current) => ({ ...current, casts: current.casts.map((item) => item.id === cast.id ? {
        ...item, favorite: !item.favorite, updatedAt: nextTimestamp(item.updatedAt),
      } : item) }))
    } catch (error) { onError(friendlyError(error)) }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!window.confirm('Удалить этот заброс? Запись исчезнет из журнала.')) return
    setBusy(true)
    try { await update((current) => removeCast(current, cast.id)); onError('Заброс удалён.') }
    catch (error) { onError(friendlyError(error)) }
    finally { setBusy(false) }
  }

  return <article className="journal-card">
    <div className="journal-title">
      <span className="journal-number" aria-label={`Заброс номер ${number}`}>{number}</span>
      <div className="journal-info"><strong>{line === null ? 'Длина неизвестна' : `≈ ${line.toFixed(1)} м`} <span>· {cast.directionDeg}°</span></strong>
        <small>{cast.fallSeconds === null ? 'Падение не замерено' : `${cast.fallSeconds.toFixed(1)} с падения`} · {cast.marks.length} отмет. · {new Date(cast.createdAt).toLocaleDateString('ru-RU')}</small></div>
      <Button type="button" tone="quiet" disabled={busy} onClick={() => { void toggleFavorite() }} aria-label={cast.favorite ? 'Убрать из избранного' : 'В избранное'}>
        <Star size={19} weight={cast.favorite ? 'fill' : 'regular'} />
      </Button>
    </div>
    <div className="sensory" aria-label="Ощущения дна">{cast.marks.length ? cast.marks.map((mark) => <span className="seg" key={mark.id} style={{ background: markColors[mark.kind] }} title={`${bottomLabels[mark.kind]} · ${mark.turns} об.`} />) : <span className="seg" style={{ background: '#e2e9de' }} />}</div>
    <div className="journal-actions"><span className="tag">{cast.favorite ? 'Избранное' : 'Наблюдение'}</span>
      <button type="button" onClick={() => setRecordOpen(true)}>Открыть</button>
      <Sheet open={recordOpen} onOpenChange={setRecordOpen} title={`Заброс #${number}`}><div className="journal-record-content journal-panel">
        <div className="journal-readout"><span>{cast.directionDeg}° · {cast.fallSeconds === null ? 'без времени' : `${cast.fallSeconds.toFixed(1)} с`}</span><strong>{line === null ? '—' : `≈ ${line.toFixed(1)} м`}</strong></div>
        <p>{line === null ? 'Полная длина лески неизвестна: подмотка неполная.' : `Выбрано ≈ ${line.toFixed(1)} м лески (не расстояние по карте).`} Падение: {cast.fallSeconds === null ? 'нет достоверного замера' : `${cast.fallSeconds.toFixed(2)} с`}. {cast.totalTurns} об. × {(cast.calibration.metersPerTurn * 100).toFixed(0)} см.</p>
        {cast.marks.length > 0 && <ul className="journal-marks">{cast.marks.map((mark) => <li key={mark.id}>{mark.turns} об. · {bottomLabels[mark.kind]}{mark.note && ` — ${mark.note}`}</li>)}</ul>}
      <form key={cast.updatedAt} className="journal-form" onSubmit={(event) => { void edit(event) }}>
      <label>Обороты ручки<input name="totalTurns" type="number" min="0" max="10000" step="any" defaultValue={cast.totalTurns} /></label>
      <label className="journal-check"><input name="completeRetrieve" type="checkbox" defaultChecked={cast.completeRetrieve} /> Вся леска выбрана</label>
      <label>Глубина, м (если измерена)<input name="depth" type="number" min="0" max="10000" step="0.01" defaultValue={cast.depth?.meters ?? ''} /></label>
      <label>Источник глубины<select name="source" defaultValue={cast.depth?.source ?? 'manual'}><option value="manual">Ручной ввод</option><option value="marker-float">Маркерный поплавок</option><option value="chart">Карта глубин</option></select></label>
      {cast.target && <label className="journal-wide journal-check"><input name="depthPosition" type="checkbox" defaultChecked={Boolean(cast.depthPosition && cast.depthPosition.lat === cast.target.lat && cast.depthPosition.lon === cast.target.lon)} /> Глубина относится к отмеченной точке</label>}
      {cast.marks.length > 0 && <details className="journal-wide journal-mark-edit"><summary>Исправить отметки ({cast.marks.length})</summary>{cast.marks.map((mark, index) => <div className="journal-form" key={mark.id}>
        <label>Обороты отметки {index + 1}<input name={`mark-${mark.id}-turns`} type="number" min="0" max="10000" step="any" defaultValue={mark.turns} /></label>
        <label>Тип отметки {index + 1}<select name={`mark-${mark.id}-kind`} defaultValue={mark.kind}>{(Object.keys(bottomLabels) as BottomKind[]).map((kind) => <option key={kind} value={kind}>{bottomLabels[kind]}</option>)}</select></label>
        <label className="journal-wide">Заметка к отметке {index + 1}<input name={`mark-${mark.id}-note`} maxLength={10_000} defaultValue={mark.note} /></label>
      </div>)}</details>}
      <label className="journal-wide">Заметка<textarea name="note" rows={2} maxLength={20_000} defaultValue={cast.note} /></label>
      <div className="journal-form-actions"><Button type="submit" disabled={busy}>Сохранить</Button><Button type="button" tone="quiet" disabled={busy} onClick={() => { void remove() }}><Trash size={17} /> Удалить</Button></div>
      </form></div></Sheet>
      <button type="button" disabled={busy} onClick={() => { void repeat() }}>Повторить</button>
    </div>
  </article>
}

export function JournalPanel({ onBack }: { onBack?: () => void } = {}) {
  const { data, loading, error, update } = useFieldStore()
  const [message, setMessage] = useState('')
  const [newName, setNewName] = useState('')
  const [pendingBackup, setPendingBackup] = useState<FieldData | null>(null)
  const [importWarning, setImportWarning] = useState<string | null>(null)
  const [pendingChart, setPendingChart] = useState<ChartDataset | null>(null)
  const [chartName, setChartName] = useState('')
  const [chartSource, setChartSource] = useState('')
  const [chartDatum, setChartDatum] = useState('')
  const [busy, setBusy] = useState(false)
  const session = data.sessions.find((item) => item.id === data.activeSessionId) ?? data.sessions[0]
  const casts = session ? data.casts.filter((cast) => cast.sessionId === session.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (data.draft) { setMessage('Сначала завершите активный промер.'); return }
    const name = newName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const created: Session = {
      id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
      station: { position: null, accuracyM: null, referenceBearingDeg: null },
      calibration: { ...defaultCalibration },
    }
    setBusy(true)
    try {
      await update((current) => {
        if (current.draft) throw new Error('Сначала завершите активный промер.')
        return { ...current, sessions: [...current.sessions, created], activeSessionId: created.id }
      })
      setNewName('')
      setMessage('Сессия создана на этом устройстве.')
    } catch (failure) { setMessage(friendlyError(failure)) }
    finally { setBusy(false) }
  }

  async function selectSession(id: string) {
    if (data.draft && data.draft.sessionId !== id) { setMessage('Сначала завершите активный промер.'); return }
    try { await update((current) => {
      if (current.draft && current.draft.sessionId !== id) throw new Error('Сначала завершите активный промер.')
      if (!current.sessions.some((item) => item.id === id)) throw new Error('Сессия больше не существует.')
      return { ...current, activeSessionId: id }
    }) }
    catch (failure) { setMessage(friendlyError(failure)) }
  }

  async function renameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) { setMessage('Введите название сессии.'); return }
    setBusy(true)
    try {
      await update((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === session.id ? {
        ...item, name, updatedAt: nextTimestamp(item.updatedAt),
      } : item) }))
      setMessage('Название сохранено.')
    } catch (failure) { setMessage(friendlyError(failure)) }
    finally { setBusy(false) }
  }

  async function deleteSession() {
    if (!session || !window.confirm(`Удалить сессию «${session.name}» и все её забросы?`)) return
    setBusy(true)
    try { await update((current) => removeSession(current, session.id)); setMessage('Сессия удалена.') }
    catch (failure) { setMessage(friendlyError(failure)) }
    finally { setBusy(false) }
  }

  async function readBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPendingBackup(null)
    setImportWarning(null)
    try {
      if (file.size > 100_000_000) throw new Error('Файл больше 100 МБ. Разделите архив перед импортом.')
      const text = await file.text()
      const preview = file.name.toLowerCase().endsWith('.html') ? parsePortableBackupHtml(text) : parseImportJson(text)
      setPendingBackup(preview.data)
      setImportWarning(preview.warning)
      setMessage('Проверьте состав копии перед импортом. Текущий промер не изменится.')
    } catch (failure) { setMessage(friendlyError(failure)) }
  }

  async function importBackup() {
    if (!pendingBackup) return
    setBusy(true)
    try {
      await update((current) => mergeBackup(current, pendingBackup))
      setPendingBackup(null)
      setImportWarning(null)
      setMessage('Данные добавлены как копии с новыми ID. Активный промер сохранён.')
    } catch (failure) { setMessage(friendlyError(failure)) }
    finally { setBusy(false) }
  }

  async function readChart(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPendingChart(null)
    try {
      if (file.size > 20_000_000) throw new Error('Файл больше 20 МБ.')
      const chart = parseChartGeoJson(await file.text(), { name: chartName, source: chartSource, verticalDatum: chartDatum })
      setPendingChart(chart)
      setMessage('Точки прочитаны. Подтвердите импорт после проверки источника и датума.')
    } catch (failure) { setMessage(friendlyError(failure)) }
  }

  async function importChart() {
    if (!pendingChart) return
    setBusy(true)
    try {
      await update((current) => ({ ...current, charts: [...current.charts, pendingChart] }))
      setPendingChart(null)
      setMessage('Карта глубин сохранена локально.')
    } catch (failure) { setMessage(friendlyError(failure)) }
    finally { setBusy(false) }
  }

  async function deleteChart(id: string) {
    if (!window.confirm('Удалить этот набор точек глубины?')) return
    try { await update((current) => ({ ...current, charts: current.charts.filter((chart) => chart.id !== id) })); setMessage('Набор удалён.') }
    catch (failure) { setMessage(friendlyError(failure)) }
  }

  return <section className="journal-panel" aria-labelledby="journal-title">
    <div className="journal-page-head"><h1 id="journal-title">Журнал</h1><span>{data.casts.length} забросов</span></div>
    <p className="journal-context">Метры — длина выбранной лески, не точная горизонтальная дальность.</p>
    {loading && <p role="status">Открываем сохранённые данные…</p>}
    {error && <p className="journal-error" role="alert">{error}</p>}
    {message && <p className="journal-message" role="status">{message}</p>}
    {!loading && <div className="journal-content">
      <details className="journal-section journal-secondary" aria-label="Сессии">
        <summary>Сессии <span>{session?.name ?? 'Новая рыбалка'} · {data.sessions.length}</span></summary>
        <form className="journal-inline" onSubmit={(event) => { void createSession(event) }}>
          <label className="sr-only" htmlFor="new-session-name">Название новой сессии</label>
          <input id="new-session-name" placeholder="Новая рыбалка" maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} />
          <Button type="submit" disabled={busy || !newName.trim()}>Создать</Button>
        </form>
        {data.sessions.length > 0 && <div className="journal-session-list">{data.sessions.map((item) => <button className={item.id === session?.id ? 'journal-session active' : 'journal-session'} key={item.id} type="button" onClick={() => { void selectSession(item.id) }}>
          <strong>{item.name}</strong><small>{data.casts.filter((cast) => cast.sessionId === item.id).length} забросов</small>
        </button>)}</div>}
        {session && <div className="journal-session-edit"><form className="journal-inline" key={session.id + session.updatedAt} onSubmit={(event) => { void renameSession(event) }}>
          <label className="sr-only" htmlFor="session-name">Название сессии</label><input id="session-name" name="name" defaultValue={session.name} maxLength={200} />
          <Button type="submit" tone="quiet" disabled={busy}>Переименовать</Button>
        </form><Button type="button" tone="quiet" disabled={busy} onClick={() => { void deleteSession() }}><Trash size={17} /> Удалить сессию</Button></div>}
      </details>

      <section className="journal-section" aria-label="Забросы">
        <div className="journal-section-head"><h2>Промеры</h2><small>{casts.length}</small></div>
        {casts.length === 0 ? <div className="journal-empty"><svg viewBox="0 0 44 44" width="44" height="44" fill="none" aria-hidden="true"><path d="M22 7c-6 0-12 2-17 5l17 28 17-28C34 9 28 7 22 7Z" stroke="currentColor" strokeWidth="2.5"/><path d="M22 7v33M9 19l13-4 13 4" stroke="currentColor" strokeWidth="2.5"/></svg><strong>Пока чистый лист</strong><p>Начните промер на секторе. Сохраните направление, падение и ощущения на обратном пути.</p><Button type="button" onClick={() => onBack ? onBack() : window.location.assign('/')}>К сектору</Button></div> : casts.map((cast, index) => <CastCard key={cast.id} cast={cast} number={casts.length - index} session={session} update={update} onError={setMessage} />)}
      </section>

      <details className="journal-section journal-secondary" aria-label="Перенос данных">
        <summary>Мои данные <span>Экспорт и импорт</span></summary>
        <p>JSON и автономный HTML сохраняют журнал и черновик. CSV содержит список забросов; для резервной копии используйте JSON или HTML.</p>
        <div className="journal-actions">
          <Button type="button" onClick={() => download('marker-backup.json', backupJson(data), 'application/json;charset=utf-8')}><DownloadSimple size={18} /> JSON</Button>
          <Button type="button" tone="quiet" onClick={() => download('marker-casts.csv', castsCsv(data), 'text/csv;charset=utf-8')}><DownloadSimple size={18} /> CSV</Button>
          <Button type="button" tone="quiet" onClick={() => { void downloadPortable(data).catch((failure) => setMessage(friendlyError(failure))) }}><DownloadSimple size={18} /> Автономный HTML</Button>
        </div>
        <label className="journal-file"><UploadSimple size={20} /> Открыть JSON или HTML-копию<input type="file" accept=".json,.html,application/json,text/html" onChange={(event) => { void readBackup(event) }} /></label>
        {pendingBackup && <div className="journal-preview"><strong>Копия готова к добавлению</strong><p>{pendingBackup.sessions.length} сессий, {pendingBackup.casts.length} забросов, {pendingBackup.charts.length} наборов глубин. Все ID будут новыми; существующие записи и текущий черновик сохранятся. {pendingBackup.draft ? data.draft ? 'В копии есть черновик: текущий черновик уже открыт, поэтому черновик копии будет пропущен.' : 'Черновик копии будет восстановлен; прерванный таймер не сохранит время падения.' : ''}</p>{importWarning && <p className="journal-warning">{importWarning}</p>}<Button type="button" disabled={busy} onClick={() => { void importBackup() }}>Импортировать копиями</Button></div>}
        {(data.legacyBackups ?? []).length > 0 && <div className="journal-legacy"><h3>Исходные старые копии</h3><p>Сохранены без изменений для повторного импорта и проверки неперенесённых полей.</p>{data.legacyBackups!.map((backup) => <div className="journal-chart" key={backup.id}><span><strong>{backup.name}</strong><small>{new Date(backup.importedAt).toLocaleString('ru-RU')}</small></span><Button type="button" tone="quiet" onClick={() => download(`marker-legacy-${backup.id}.json`, backup.source, 'application/json;charset=utf-8')}>Скачать исходник</Button></div>)}</div>}
      </details>

      <details id="depths" className="journal-section journal-secondary" aria-label="Точки глубин">
        <summary>Точки глубин <span>GeoJSON · {data.charts.length}</span></summary>
        <p>Принимаются только Point с числовым полем <code>depthM</code>, <code>depth_m</code> или <code>depth</code> в метрах. Это исходные точки, не готовая карта рельефа. Для S-57 нужен отдельный конвертер и проверка источника.</p>
        <div className="journal-form">
          <label>Название набора<input value={chartName} onChange={(event) => setChartName(event.target.value)} maxLength={200} /></label>
          <label>Источник<input value={chartSource} onChange={(event) => setChartSource(event.target.value)} maxLength={500} placeholder="Название файла или поставщика" /></label>
          <label>Вертикальный датум<input value={chartDatum} onChange={(event) => setChartDatum(event.target.value)} maxLength={200} placeholder="Как указано в источнике" /></label>
        </div>
        <label className="journal-file"><UploadSimple size={20} /> Открыть GeoJSON<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => { void readChart(event) }} /></label>
        {pendingChart && <div className="journal-preview"><strong>{pendingChart.name}</strong><p>{pendingChart.points.length} точек · {pendingChart.source} · датум: {pendingChart.verticalDatum}. Глубины {chartRange(pendingChart)}.</p><Button type="button" disabled={busy} onClick={() => { void importChart() }}>Сохранить точки</Button></div>}
        {data.charts.map((chart) => <div key={chart.id} className="journal-chart"><span><strong>{chart.name}</strong><small>{chart.points.length} точек · {chart.source} · {chart.verticalDatum}</small></span><Button type="button" tone="quiet" onClick={() => { void deleteChart(chart.id) }} aria-label={`Удалить ${chart.name}`}><Trash size={17} /></Button></div>)}
      </details>
    </div>}
  </section>
}
