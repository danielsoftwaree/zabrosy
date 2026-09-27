import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react'
import { Drop } from '@phosphor-icons/react/dist/csr/Drop'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { CaretUp } from '@phosphor-icons/react/dist/csr/CaretUp'
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown'
import { Accordion, Button, Sheet } from '../../shared/ui'
import { useFieldUi } from '../../shared/ui/field-ui'
import { bottomLabels, type BottomKind, type Coordinate, type Draft, type FieldData } from '../../shared/model'
import { useFieldStore } from '../../shared/storage'
import { addMark, bottom, calibrationFromInput, changeMarkNote, changeMarkTurns, decimal, interrupt, newDraft, newSession, removeMark, sameFrame, setTurns, skipFall, targetDirection, toCast, water } from './domain'
import { SectorView } from './sector-view'
import './survey.css'

type Props = { target?: Coordinate | null; surface?: ReactNode; footer?: ReactNode | null }
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить изменение.'
const marks = Object.keys(bottomLabels) as BottomKind[]

function TapAction({ children, onActivate, className = '' }: { children: ReactNode; onActivate: (at: number) => void; className?: string }) {
  const down = useRef<{ id: number; at: number } | null>(null)
  function release(event: PointerEvent<HTMLButtonElement>) {
    const gesture = down.current
    down.current = null
    if (!gesture || gesture.id !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) onActivate(gesture.at)
  }
  return <button type="button" className={`survey-tap ${className}`} onPointerDown={(event) => { down.current = { id: event.pointerId, at: performance.now() } }} onPointerUp={release} onPointerCancel={() => { down.current = null }} onClick={(event) => { if (event.detail === 0) onActivate(performance.now()) }}>{children}</button>
}

export function SurveyPanel({ target, surface, footer }: Props) {
  const { data, loading, error: storageError, update } = useFieldStore()
  const dockExpanded = useFieldUi((state) => state.expanded)
  const setDockExpanded = useFieldUi((state) => state.setExpanded)
  const [angleOverride, setAngleOverride] = useState<{ sessionId: string | null; value: string } | null>(null)
  const [lineOverride, setLineOverride] = useState<{ sessionId: string | null; value: string } | null>(null)
  const [turnsText, setTurnsText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)
  const [undoCount, setUndoCount] = useState(0)
  const [sheet, setSheet] = useState<'session' | 'calibration' | 'distance' | 'direction' | 'turns' | 'marks' | 'review' | null>(null)
  const liveFall = useRef<string | null>(null)
  const saveLock = useRef(false)
  const undo = useRef<Draft[]>([])
  const session = data.sessions.find((item) => item.id === data.activeSessionId) ?? null
  const draft = data.draft
  const sessionCasts = data.casts.filter((cast) => cast.sessionId === (draft?.sessionId ?? session?.id))
  const frame = draft?.station ?? session?.station
  const visibleCasts = frame ? sessionCasts.filter((cast) => sameFrame(cast.station, frame)) : []
  const selectedTarget = target === undefined ? session?.target ?? null : target
  const suggestedAngle = session ? targetDirection(session, selectedTarget) : null
  const manuallySet = angleOverride?.sessionId === (session?.id ?? null)
  const angleText = manuallySet ? angleOverride.value : String(suggestedAngle === null ? 0 : Math.round(suggestedAngle))
  const previewDirection = decimal(angleText)
  const lineText = lineOverride?.sessionId === (session?.id ?? null) ? lineOverride.value : String(session?.plannedLineM ?? 30)
  const previewLine = decimal(lineText)

  function chooseAim(angle: number, meters: number) {
    setAngleOverride({ sessionId: session?.id ?? null, value: String(angle) })
    setLineOverride({ sessionId: session?.id ?? null, value: String(meters) })
    if (session) void mutate((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === session.id ? { ...item, plannedLineM: meters, updatedAt: new Date().toISOString() } : item) }))
  }

  async function mutate(fn: (current: FieldData) => FieldData) {
    try { await update(fn); setProblem(null); return true }
    catch (error) { setProblem(message(error)); return false }
  }

  async function changeDraft(fn: (current: Draft) => Draft, canUndo = false) {
    const before = undo.current.length
    const saved = await mutate((current) => {
      if (!current.draft) return current
      const next = fn(current.draft)
      if (next === current.draft) return current
      if (canUndo) undo.current.push(current.draft)
      return { ...current, draft: next }
    })
    if (!saved) undo.current.length = before
    setUndoCount(undo.current.length)
    return saved
  }

  // A live monotonic clock is intentionally kept only for this page instance.
  useEffect(() => {
    if (draft?.stage !== 'falling' || liveFall.current !== draft.id) return
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (liveFall.current === draft.id && draft.startedAt !== null && now - draft.startedAt >= 600_000) {
        liveFall.current = null
        void update((current) => current.draft?.id === draft.id ? { ...current, draft: interrupt(current.draft) } : current).catch((error) => setProblem(message(error)))
      } else setTick(now)
    }, 100)
    return () => window.clearInterval(timer)
  }, [draft?.id, draft?.stage, draft?.startedAt, update])

  // Visibility and unmount are external lifecycle events: an uncertain fall must not become a measurement.
  useEffect(() => {
    const stop = () => {
      const id = liveFall.current
      if (!id) return
      liveFall.current = null
      void update((current) => current.draft?.id === id ? { ...current, draft: interrupt(current.draft) } : current).catch(() => undefined)
    }
    const hidden = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [update])

  async function start() {
    const value = decimal(angleText)
    if (value === null || value < -180 || value > 180) { setProblem('Угол должен быть от −180° до 180°.'); return }
    const plannedLineM = decimal(lineText)
    if (plannedLineM === null || plannedLineM < 1 || plannedLineM > 180) { setProblem('Оценка лески должна быть от 1 до 180 м.'); return }
    undo.current = []
    setUndoCount(0)
    await mutate((current) => {
      if (current.draft) throw new Error('Сначала заверши или отмени текущий заброс.')
      const selected = { ...(current.sessions.find((item) => item.id === current.activeSessionId) ?? newSession()), plannedLineM }
      return {
        ...current,
        sessions: current.sessions.some((item) => item.id === selected.id) ? current.sessions.map((item) => item.id === selected.id ? selected : item) : [...current.sessions, selected],
        activeSessionId: selected.id,
        draft: newDraft(selected, value, target === undefined ? selected.target ?? null : target),
      }
    })
    setNotice(null)
  }

  function waterTap(at: number) {
    if (!draft) return
    liveFall.current = draft.id
    void changeDraft((current) => water(current, at))
  }

  function bottomTap(at: number) {
    liveFall.current = null
    void changeDraft((current) => bottom(current, at))
  }

  function cancel() {
    if (!draft || !window.confirm('Удалить незавершённый заброс?')) return
    liveFall.current = null
    undo.current = []
    setUndoCount(0)
    void mutate((current) => ({ ...current, draft: null }))
  }

  function addTurns(amount: number) {
    void changeDraft((current) => setTurns(current, current.totalTurns + amount), true)
  }

  function undoLast() {
    const previous = undo.current.pop()
    if (!previous) return
    void mutate((current) => current.draft?.id === previous.id && current.draft.stage === 'retrieve' ? { ...current, draft: previous } : current)
    setUndoCount(undo.current.length)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveLock.current) return
    const form = new FormData(event.currentTarget)
    const rawDepth = String(form.get('depth') ?? '').trim()
    const depthMeters = rawDepth ? decimal(rawDepth) : null
    if (rawDepth && depthMeters === null) { setProblem('Проверь введённую глубину.'); return }
    const complete = form.get('complete') === 'on'
    const note = String(form.get('note') ?? '')
    saveLock.current = true
    setSaving(true)
    try {
      await update((current) => {
        if (!current.draft || current.draft.stage !== 'review') throw new Error('Черновик изменился. Проверь заброс снова.')
        const cast = toCast(current.draft, complete, depthMeters, note, form.get('depthAtTarget') === 'on')
        return { ...current, casts: [...current.casts, cast], draft: null }
      })
      undo.current = []
      setUndoCount(0)
      setProblem(null)
      setNotice('Заброс сохранён на этом устройстве.')
      setSheet(null)
    } catch (error) { setProblem(message(error)) }
    finally { saveLock.current = false; setSaving(false) }
  }

  async function saveCalibration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft) return
    const form = new FormData(event.currentTarget)
    let calibration
    try { calibration = calibrationFromInput(String(form.get('length') ?? ''), String(form.get('turns') ?? ''), String(form.get('perTurn') ?? '')) }
    catch (error) { setProblem(message(error)); return }
    const saved = await mutate((current) => {
      const selected = current.sessions.find((item) => item.id === current.activeSessionId)
      if (!selected) {
        const created = { ...newSession(), calibration }
        return { ...current, sessions: [...current.sessions, created], activeSessionId: created.id }
      }
      return { ...current, sessions: current.sessions.map((item) => item.id === selected.id ? { ...item, calibration, updatedAt: new Date().toISOString() } : item) }
    })
    if (saved) {
      setNotice('Калибровка сохранена для следующих забросов.')
      setSheet(null)
    }
  }

  if (loading) return <div className="survey-panel survey-loading" role="status">Открываем локальный журнал…</div>

  const stage = draft?.stage ?? 'idle'
  const castNumber = sessionCasts.length + 1
  const lastMark = draft?.marks.at(-1)
  const distance = draft?.completeRetrieve ? Math.round(draft.totalTurns * draft.calibration.metersPerTurn * 10) / 10 : null
  const compactDock = Boolean(surface) && !dockExpanded && stage !== 'retrieve'
  const shownFooter = stage === 'idle' || stage === 'armed' ? footer : null

  return <div className={`survey-panel survey-panel--${stage}${surface ? ' survey-panel--map' : ''}`}>
    <h1 className="survey-visually-hidden">Промер</h1>
    <div className="survey-surface">
      {surface ?? <SectorView casts={visibleCasts} draft={draft} hiddenCount={sessionCasts.length - visibleCasts.length} previewDirectionDeg={!draft && previewDirection !== null && previewDirection >= -180 && previewDirection <= 180 ? previewDirection : null} previewLineM={previewLine ?? 30} onAimChange={draft ? undefined : chooseAim} />}
    </div>
    {(storageError || problem || notice) && <div className={`survey-toast ${storageError || problem ? 'survey-toast--error' : ''}`} role={storageError || problem ? 'alert' : 'status'}>{storageError || problem || notice}</div>}
    {shownFooter == null ? <section className={`survey-dock${compactDock ? ' survey-dock--compact' : ''}`} aria-label="Управление промером">
      <div className="survey-dock-handle" aria-hidden="true" />
      {!draft && <>
        <div className="survey-dock-line"><button type="button" className="survey-eyebrow" aria-label={`Заброс #${castNumber}, ${session?.name ?? 'новая сессия'}. Выбрать сессию`} onClick={() => setSheet('session')}>Заброс #{castNumber}</button><button type="button" className="survey-subtle" onClick={() => setSheet('calibration')}>Катушка: {session?.calibration.source !== 'measured' ? '≈ ' : ''}{Math.round((session?.calibration.metersPerTurn ?? .8) * 100)} см/об.</button></div>
        <div className="survey-metrics">
          <button type="button" className="survey-metric" onClick={() => setSheet('distance')}><strong>≈ {lineText} <small>м</small></strong><span>длина лески · оценка</span></button>
          <button type="button" className="survey-metric" onClick={() => setSheet('direction')}><strong>{angleText}°</strong><span>{suggestedAngle !== null && !manuallySet ? 'до цели' : 'по ориентиру'}</span></button>
        </div>
        <Button type="button" className="survey-primary" onClick={() => { void start() }}>Начать промер <ArrowRight size={21} aria-hidden="true" /></Button>
        <p className="survey-dock-caption">Касание сектора — направление и примерные метры</p>
      </>}
      {(stage === 'armed' || stage === 'falling') && draft && <>
        <div className="survey-dock-line"><span className="survey-eyebrow">#{castNumber} · {draft.directionDeg}°</span><span className="survey-small">{stage === 'falling' ? 'Замер падения' : 'Ожидаем приводнения'}</span></div>
        {stage === 'armed' ? <TapAction className="survey-tap--large" onActivate={waterTap}><Drop size={35} aria-hidden="true" /><strong>Коснулся воды</strong><small>Нажми в момент приводнения груза</small></TapAction>
          : <TapAction className="survey-tap--large survey-tap--falling" onActivate={bottomTap}><span className="survey-timer" role="timer">{tick && draft.startedAt !== null ? Math.max(0, (tick - draft.startedAt) / 1000).toFixed(1).replace('.', ',') : '0,0'}</span><strong>Дно · остановить</strong><small>Нажми в момент касания дна</small></TapAction>}
        <div className="survey-dock-footer"><button type="button" onClick={cancel}>Отменить</button><button type="button" onClick={() => { liveFall.current = null; void changeDraft(stage === 'armed' ? skipFall : interrupt) }}>{stage === 'armed' ? 'Пропустить таймер' : 'Прервать замер'}</button></div>
      </>}
      {stage === 'interrupted' && <><div className="survey-dock-line"><span className="survey-eyebrow">Таймер прерван</span><button type="button" className="survey-subtle" onClick={cancel}>Отмена</button></div><p className="survey-dock-message">Время падения не сохранено. Обороты и отметки на месте.</p><div className="survey-dock-stack"><Button className="survey-primary" type="button" onClick={() => { void changeDraft((current) => ({ ...current, stage: 'armed', startedAt: null })) }}>Повторить падение</Button><Button tone="quiet" type="button" onClick={() => { void changeDraft(skipFall) }}>Продолжить без времени</Button></div></>}
      {stage === 'retrieve' && draft && <>
        <div className="survey-dock-line"><span className="survey-eyebrow">Протяжка · #{castNumber}</span><span className="survey-small">{draft.fallSeconds === null ? 'Без замера падения' : `${draft.fallSeconds.toFixed(1)} с до дна`}</span></div>
        <div className="survey-counter-row"><button type="button" className="survey-counter-value" onClick={() => setSheet('turns')}><strong>{draft.totalTurns}</strong><span>оборотов ручки · изменить</span></button><button type="button" className="survey-counter-add" onClick={() => addTurns(1)} aria-label="Добавить один оборот ручки">+1</button><button type="button" className="survey-counter-add survey-counter-add--light" onClick={() => addTurns(5)} aria-label="Добавить пять оборотов ручки">+5</button></div>
        <div className="survey-trace"><span>{lastMark ? `${bottomLabels[lastMark.kind]} · ${lastMark.turns} об. · ${draft.marks.length} отмет.` : 'Ощутил изменение? Отметь ниже.'}</span><button type="button" onClick={undoLast} disabled={!undoCount}><ArrowCounterClockwise size={14} aria-hidden="true" /> Отменить</button></div>
        <div className="survey-feel-grid">{marks.map((kind) => <button type="button" key={kind} onClick={() => { void changeDraft((current) => addMark(current, kind), true) }}><span className={`survey-feel-dot survey-feel-dot--${kind}`} />{bottomLabels[kind]}</button>)}</div>
        <Button className="survey-primary" type="button" onClick={() => { void changeDraft((current) => ({ ...current, stage: 'review' })).then((saved) => { if (saved) setSheet('review') }) }}>Закончить промер <Check size={21} aria-hidden="true" /></Button>
        <div className="survey-dock-footer"><button type="button" onClick={() => setSheet('marks')}>Отметки · {draft.marks.length}</button><button type="button" onClick={cancel}>Отменить заброс</button></div>
      </>}
      {stage === 'review' && draft && <><div className="survey-dock-line"><span className="survey-eyebrow">Проверка · #{castNumber}</span><span className="survey-small">{draft.totalTurns} об. · {draft.marks.length} отмет.</span></div><p className="survey-dock-message">{distance === null ? 'Длина лески неизвестна до полной подмотки.' : `≈ ${distance} м лески по оборотам, не дальность на карте.`}</p><Button className="survey-primary" type="button" onClick={() => setSheet('review')}>Проверить и сохранить</Button><div className="survey-dock-footer"><button type="button" onClick={() => { void changeDraft((current) => ({ ...current, stage: 'retrieve' })) }}>К подмотке</button><button type="button" onClick={cancel}>Отменить заброс</button></div></>}
      {surface && stage !== 'retrieve' && <button type="button" className="survey-dock-toggle" aria-expanded={dockExpanded} aria-label={dockExpanded ? 'Свернуть параметры промера' : 'Показать параметры промера'} onClick={() => setDockExpanded(!dockExpanded)}>{dockExpanded ? 'Свернуть' : 'Параметры'}{dockExpanded ? <CaretDown size={16} aria-hidden="true" /> : <CaretUp size={16} aria-hidden="true" />}</button>}
    </section> : shownFooter}
    <Sheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null) }} title={{ session: 'Сессия', calibration: 'Катушка', distance: 'Примерная длина лески', direction: 'Направление заброса', turns: 'Обороты ручки', marks: 'Отметки протяжки', review: 'Проверь заброс' }[sheet ?? 'session']}>
      {(problem || storageError) && <p className="survey-sheet-error" role="alert">{problem || storageError}</p>}
      {sheet === 'session' && <div className="survey-sheet-body"><label className="survey-field">Сессия<select value={session?.id ?? ''} onChange={(event) => { const id = event.target.value; void mutate((current) => ({ ...current, activeSessionId: id || null })).then((saved) => { if (saved) setSheet(null) }) }}>{!session && <option value="">Новая сессия</option>}{data.sessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button type="button" onClick={() => { void mutate((current) => { const created = newSession(); return { ...current, sessions: [...current.sessions, created], activeSessionId: created.id } }).then((saved) => { if (saved) setSheet(null) }) }}>Новая сессия</Button></div>}
      {sheet === 'calibration' && <form className="survey-sheet-body" onSubmit={(event) => { void saveCalibration(event) }} key={session?.id ?? 'new'}><p>Длина лески за оборот ручки. Измеренная выборка точнее оценки.</p><label className="survey-field">Длина лески, м<input name="length" type="text" inputMode="decimal" defaultValue={session?.calibration.measuredLengthM ?? ''} /></label><label className="survey-field">Обороты ручки<input name="turns" type="text" inputMode="decimal" defaultValue={session?.calibration.measuredTurns ?? ''} /></label><Accordion title="Оценка без измерения" defaultOpen={session?.calibration.source !== 'measured'}><label className="survey-field">Метры за оборот ручки<input name="perTurn" type="text" inputMode="decimal" defaultValue={session?.calibration.metersPerTurn ?? .8} /></label></Accordion><Button type="submit">Сохранить калибровку</Button></form>}
      {sheet === 'distance' && <div className="survey-sheet-body"><label className="survey-field">Метры по леске · предварительная оценка<input className="survey-angle-input" type="text" inputMode="decimal" value={lineText} onChange={(event) => setLineOverride({ sessionId: session?.id ?? null, value: event.target.value })} /></label><div className="survey-angle-pills">{[10, 20, 30, 40, 50].map((meters) => <button type="button" key={meters} onClick={() => setLineOverride({ sessionId: session?.id ?? null, value: String(meters) })}>{meters} м</button>)}</div><p>После полной подмотки длина уточнится по оборотам. Это не точная дальность по карте.</p><Button type="button" onClick={() => { const meters = decimal(lineText); if (meters === null || meters < 1 || meters > 180) { setProblem('Выбери длину лески от 1 до 180 м.'); return } if (session) void mutate((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === session.id ? { ...item, plannedLineM: meters, updatedAt: new Date().toISOString() } : item) })).then((saved) => { if (saved) setSheet(null) }); else { setProblem(null); setSheet(null) } }}>Готово</Button></div>}
      {sheet === 'direction' && <div className="survey-sheet-body"><label className="survey-field">Угол от ориентира: минус — влево, плюс — вправо<input className="survey-angle-input" type="text" inputMode="decimal" value={angleText} onChange={(event) => setAngleOverride({ sessionId: session?.id ?? null, value: event.target.value })} /></label><div className="survey-angle-pills">{[-30, -15, 0, 15, 30].map((angle) => <button type="button" key={angle} onClick={() => setAngleOverride({ sessionId: session?.id ?? null, value: String(angle) })}>{angle > 0 ? '+' : ''}{angle}°</button>)}</div>{suggestedAngle !== null && <Button tone="quiet" type="button" onClick={() => setAngleOverride(null)}>Взять направление до цели</Button>}<Button type="button" onClick={() => { const value = decimal(angleText); if (value === null || value < -180 || value > 180) { setProblem('Угол должен быть от −180° до 180°.'); return } setProblem(null); setSheet(null) }}>Использовать угол</Button></div>}
      {sheet === 'turns' && draft && <div className="survey-sheet-body"><label className="survey-field">С начала этой протяжки<input className="survey-angle-input" type="text" inputMode="decimal" value={turnsText} placeholder={String(draft.totalTurns)} onChange={(event) => setTurnsText(event.target.value)} /></label><p>Считай полные обороты ручки, не ротора.</p><Button type="button" onClick={() => { const value = decimal(turnsText || String(draft.totalTurns)); if (value === null) { setProblem('Введи число оборотов.'); return } void changeDraft((current) => setTurns(current, value), true).then((saved) => { if (saved) { setTurnsText(''); setSheet(null) } }) }}>Применить</Button></div>}
      {sheet === 'marks' && draft && <div className="survey-sheet-body">{draft.marks.length === 0 ? <p>Отметок пока нет.</p> : <ol className="survey-mark-list">{draft.marks.map((mark) => <li key={mark.id}><strong>{bottomLabels[mark.kind]}</strong><label className="survey-field">Обороты<input type="text" inputMode="decimal" defaultValue={mark.turns} onBlur={(event) => { const value = decimal(event.currentTarget.value); if (value === null) { setProblem('Проверь число оборотов.'); return } void changeDraft((current) => changeMarkTurns(current, mark.id, value), true) }} /></label><label className="survey-field">Заметка<input type="text" defaultValue={mark.note} onBlur={(event) => { const note = event.currentTarget.value; void changeDraft((current) => changeMarkNote(current, mark.id, note), true) }} /></label><button type="button" onClick={() => { void changeDraft((current) => removeMark(current, mark.id), true) }}>Удалить</button></li>)}</ol>}<Button tone="quiet" type="button" onClick={() => setSheet(null)}>Готово</Button></div>}
      {sheet === 'review' && draft && <form className="survey-sheet-body" onSubmit={(event) => { void save(event) }} key={draft.id}><p>{draft.totalTurns} оборотов · {draft.marks.length} отметок · падение {draft.fallSeconds === null ? 'без времени' : `${draft.fallSeconds.toFixed(1)} с`}</p><label className="survey-check"><input type="checkbox" name="complete" defaultChecked={draft.completeRetrieve} onChange={(event) => { const completeRetrieve = event.currentTarget.checked; void changeDraft((current) => ({ ...current, completeRetrieve })) }} />Вся леска выбрана и вся подмотка посчитана</label><p>{draft.completeRetrieve ? `≈ ${Math.round(draft.totalTurns * draft.calibration.metersPerTurn * 10) / 10} м лески по оборотам.` : 'При неполной подмотке длина лески неизвестна.'} Это не расстояние по карте.</p><label className="survey-field">Глубина, м · вручную, необязательно<input name="depth" type="text" inputMode="decimal" defaultValue={draft.depth?.meters ?? ''} /></label>{draft.target && <><label className="survey-check"><input type="checkbox" name="depthAtTarget" />Глубина относится к отмеченной точке</label><p>Цель была запланирована. Подтверди точку, только если глубина измерена именно там.</p></>}<label className="survey-field">Заметка<textarea name="note" rows={3} defaultValue={draft.note} /></label><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить заброс'}</Button></form>}
    </Sheet>
  </div>
}
