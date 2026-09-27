import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Gps } from '@phosphor-icons/react/dist/csr/Gps'
import { Target } from '@phosphor-icons/react/dist/csr/Target'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Minus } from '@phosphor-icons/react/dist/csr/Minus'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { Button } from '../../shared/ui'
import { useFieldUi } from '../../shared/ui/field-ui'
import { useFieldStore } from '../../shared/storage'
import type { Coordinate, FieldData, Session } from '../../shared/model'
import { newSession } from '../survey'
import { BottomView } from './bottom'
import { CameraView } from './camera'
import { CanvasMap, type CanvasMapApi, type CanvasMapView, type MapImageStatus } from './canvas-map'
import { imageryProviders } from './imagery-providers'
import { CEGIELINKA, bearingDegrees, distanceMeters } from './geometry'
import { relativeAngle } from '../../shared/platform/sensors'
import './map.css'

type View = 'sector' | 'aerial' | 'camera' | 'bottom'
type Props = { view?: View; children?: (surface: ReactNode, footer: ReactNode | null) => ReactNode }
function nextTimestamp(previous: string) { return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString() }
function editableSession(current: FieldData, id: string, allowArmed: boolean): Session {
  if (current.activeSessionId !== id) throw new Error('Активная сессия изменилась. Выберите точку заново.')
  const session = current.sessions.find(item => item.id === id)
  if (!session) throw new Error('Сессия больше недоступна. Выберите точку заново.')
  if (current.draft && (!allowArmed || current.draft.stage !== 'armed' || current.draft.sessionId !== id)) {
    throw new Error('Привязку нельзя менять во время промера.')
  }
  return session
}
function coordinateNumber(value: string, min: number, max: number) {
  const input = value.trim().replace(',', '.')
  const number = Number(input)
  return input && Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function MapPanel({ view: controlledView, children }: Props) {
  const { data, loading, error, update } = useFieldStore()
  const drawer = useFieldUi(state => state.drawer)
  const setDrawer = useFieldUi(state => state.setDrawer)
  const [internalView, setInternalView] = useState<View>('aerial')
  const activeView = controlledView ?? internalView
  const embedded = Boolean(children)
  const mapApi = useRef<CanvasMapApi | null>(null)
  const mapView = useRef<CanvasMapView | null>(null)
  const [viewWidthM, setViewWidthM] = useState(280)
  const [providerId, setProviderId] = useState('gugik-high')
  const [candidate, setCandidate] = useState<Coordinate | null>(null)
  const [latitude, setLatitude] = useState(String(CEGIELINKA.lat))
  const [longitude, setLongitude] = useState(String(CEGIELINKA.lon))
  const [imageStatus, setImageStatus] = useState<MapImageStatus>('loading')
  const [positionStatus, setPositionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const provider = imageryProviders.find(item => item.id === providerId) ?? imageryProviders[0]
  const session = data.sessions.find((item) => item.id === data.activeSessionId) ?? null
  const locked = Boolean(data.draft && data.draft.stage !== 'armed')
  const station = session?.station.position ?? null
  const target = data.draft?.target ?? session?.target ?? null
  const visibleCasts = data.casts.filter((cast) => cast.sessionId === session?.id && cast.target)
  const targetBearing = station && target ? bearingDegrees(station, target) : null
  const targetDistance = station && target ? distanceMeters(station, target) : null

  function mapTap(point: Coordinate) {
    if (locked || imageStatus !== 'ready') return
    setCandidate(point)
    setDrawer('point')
    setLatitude(point.lat.toFixed(7))
    setLongitude(point.lon.toFixed(7))
    setActionError('')
  }

  function chooseCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const lat = coordinateNumber(latitude, -90, 90)
    const lon = coordinateNumber(longitude, -180, 180)
    if (lat === null || lon === null) {
      setActionError('Введите широту от −90 до 90 и долготу от −180 до 180.')
      return
    }
    const point = { lat, lon }
    setCandidate(point)
    setDrawer('point')
    mapApi.current?.centerAt(point)
    setActionError('')
  }

  async function saveTarget() {
    if (!session || !candidate || locked) return
    try {
      setActionError('')
      await update((current) => {
        editableSession(current, session.id, true)
        return {
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id ? { ...item, target: candidate, updatedAt: nextTimestamp(item.updatedAt) } : item),
        draft: current.draft?.stage === 'armed'
          ? { ...current.draft, target: candidate,
            directionDeg: current.draft.station.position && current.draft.station.referenceBearingDeg !== null
              ? relativeAngle(bearingDegrees(current.draft.station.position, candidate), current.draft.station.referenceBearingDeg)
              : current.draft.directionDeg }
          : current.draft,
        }
      })
      setCandidate(null)
      setDrawer('survey')
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Цель не сохранилась. Повторите попытку.') }
  }

  async function createSession() {
    if (session) return
    try {
      setActionError('')
      await update((current) => {
        if (current.activeSessionId && current.sessions.some(item => item.id === current.activeSessionId)) return current
        const created = newSession()
        return { ...current, sessions: [...current.sessions, created], activeSessionId: created.id }
      })
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Сессия не создалась. Повторите попытку.') }
  }

  async function setStation(position: Coordinate) {
    if (!session || data.draft || locked) return
    try {
      setActionError('')
      await update((current) => {
        editableSession(current, session.id, false)
        return { ...current, sessions: current.sessions.map((item) => item.id === session.id
          ? { ...item, station: { ...item.station, position, accuracyM: null, referenceBearingDeg: null }, updatedAt: nextTimestamp(item.updatedAt) } : item) }
      })
      setCandidate(null)
      setDrawer('survey')
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Станция не сохранилась. Повторите попытку.') }
  }

  async function setReference() {
    if (!session || !station || !candidate || data.draft) return
    try {
      setActionError('')
      await update((current) => {
        const selected = editableSession(current, session.id, false)
        if (!selected.station.position || selected.station.position.lat !== station.lat || selected.station.position.lon !== station.lon) {
          throw new Error('Станция изменилась. Выберите ориентир заново.')
        }
        return { ...current, sessions: current.sessions.map((item) => item.id === session.id
          ? { ...item, station: { ...item.station, referenceBearingDeg: bearingDegrees(station, candidate) }, updatedAt: nextTimestamp(item.updatedAt) } : item) }
      })
      setCandidate(null)
      setDrawer('survey')
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Ориентир не сохранился. Повторите попытку.') }
  }

  function locate() {
    setDrawer('coordinates')
    if (!navigator.geolocation) { setPositionStatus('Геолокация недоступна. Можно ввести координаты вручную.'); return }
    setPositionStatus('Определяем положение…')
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapApi.current?.centerAt({ lat: coords.latitude, lon: coords.longitude })
      setLatitude(coords.latitude.toFixed(7))
      setLongitude(coords.longitude.toFixed(7))
      setCandidate(null)
      setPositionStatus(`Положение устройства · точность ±${Math.round(coords.accuracy)} м. Это ещё не сохранённая станция.`)
    }, () => setPositionStatus('Геолокация недоступна. Можно ввести координаты вручную.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  const surface = activeView === 'sector' ? null : <section className={`map-panel ${embedded ? 'map-panel--embedded' : 'map-panel--standalone'}${drawer !== 'survey' ? ' map-panel--selecting' : ''}`} aria-label="Карта участка">
    {!embedded && <div className="map-panel__heading"><h1>Карта участка</h1>
      <div className="map-view-switch" role="group" aria-label="Представление карты">
        <button aria-pressed={activeView === 'aerial'} onClick={() => setInternalView('aerial')}>Снимок</button>
        <button aria-pressed={activeView === 'camera'} onClick={() => setInternalView('camera')}>Камера</button>
        <button aria-pressed={activeView === 'bottom'} onClick={() => setInternalView('bottom')}>Дно</button>
      </div>
    </div>}
    <div className="map-panel__surface">
      {activeView === 'aerial' && <>
        <div className="field-map__frame" data-imagery-status={imageStatus} aria-busy={imageStatus === 'loading'}>
          <CanvasMap apiRef={mapApi} viewRef={mapView} provider={provider} station={station} referenceBearingDeg={session?.station.referenceBearingDeg ?? null} target={target} casts={visibleCasts} candidate={candidate} locked={locked || imageStatus !== 'ready'} onPick={mapTap} onStatus={setImageStatus} onWidth={setViewWidthM} />
          {imageStatus !== 'ready' && <div className="field-map__fallback">{imageStatus === 'error' ? 'Снимок недоступен. Повторите загрузку или введите координаты вручную.' : 'Загружаем снимок…'}</div>}
        </div>
        <div className="map-panel__top-shade" aria-hidden="true" />
        <div className="map-panel__info"><strong>{provider.id === 'gugik-high' ? 'Geoportal · снимок' : provider.label}</strong>
          <p>{imageStatus === 'error' ? 'Снимок недоступен · координаты вручную' : 'Выберите точку на снимке · дно здесь не показано'}</p>
          {imageStatus === 'error' && <button type="button" className="map-panel__retry" onClick={() => mapApi.current?.retry()}>Повторить загрузку</button>}
          {target && <p className="map-panel__target">Цель {target.lat.toFixed(6)}, {target.lon.toFixed(6)}{targetDistance !== null ? ` · ≈${Math.round(targetDistance)} м от станции` : ''}</p>}
        </div>
        <div className="map-panel__rail" role="group" aria-label="Управление снимком">
          <button type="button" onClick={locate} disabled={embedded && locked} aria-label="Моя позиция" title="Моя позиция"><Gps size={21} /></button>
          <button type="button" onClick={() => mapApi.current?.centerAt(station ?? CEGIELINKA)} aria-label="К станции" title="К станции"><Target size={21} /></button>
          <div className="map-panel__zoom"><button type="button" onClick={() => mapApi.current?.zoom(.5)} aria-label="Приблизить"><Plus size={20} /></button>
            <button type="button" onClick={() => mapApi.current?.zoom(2)} aria-label="Отдалить"><Minus size={20} /></button></div>
          <button type="button" onClick={() => { setCandidate(null); setActionError(''); setDrawer('coordinates') }} disabled={embedded && locked} aria-label="Точка и настройки" title="Точка и настройки"><SlidersHorizontal size={21} /></button>
        </div>
        <p className="field-map__source">{provider.attribution}</p>
      </>}
      {activeView === 'camera' && <CameraView active targetBearing={targetBearing} referenceBearing={session?.station.referenceBearingDeg ?? null} targetDistance={targetDistance} />}
      {activeView === 'bottom' && <BottomView station={station} casts={visibleCasts} charts={data.charts} />}
      {loading && <p className="map-panel__status" role="status">Загружаем локальные данные…</p>}
      {error && <p className="map-panel__status map-error" role="alert">{error}</p>}
    </div>
  </section>

  const footer = activeView !== 'aerial' || drawer === 'survey' ? null : <section className="map-footer" aria-label={drawer === 'point' ? 'Выбранная точка' : 'Координаты и навигация'}>
    <div className="map-footer__handle" aria-hidden="true" />
    <div className="map-footer__head">
      <strong>{drawer === 'point' && candidate ? 'Выбрана точка' : 'Точка и настройки'}</strong>
      <button type="button" className="map-footer__back" onClick={() => { setActionError(''); setDrawer('survey') }}>К промеру</button>
    </div>
    {drawer === 'point' && candidate ? <>
      <p className="map-footer__position">{candidate.lat.toFixed(6)}, {candidate.lon.toFixed(6)}</p>
      {station && <p className="map-footer__distance">От станции ≈ {Math.round(distanceMeters(station, candidate))} м по карте · {Math.round(bearingDegrees(station, candidate))}°</p>}
      {session ? <div className="map-footer__actions">
        <Button onClick={saveTarget} disabled={!session || locked}>Сохранить цель</Button>
        <Button tone="quiet" onClick={() => setStation(candidate)} disabled={!session || Boolean(data.draft)}>Это станция</Button>
        <Button tone="quiet" onClick={setReference} disabled={!session || !station || Boolean(data.draft)}>Это ориентир</Button>
      </div> : <Button className="map-footer__create" type="button" onClick={createSession}>Создать сессию</Button>}
      {locked && <p className="map-hint">Во время промера цель и привязку менять нельзя.</p>}
    </> : <>
      <form className="field-map__coordinates" onSubmit={chooseCoordinates}>
        <strong>Координаты WGS84</strong>
        <div><label>Широта<input type="text" inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <label>Долгота<input type="text" inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} autoComplete="off" spellCheck={false} /></label></div>
        <Button type="submit" tone="quiet">Выбрать точку</Button>
      </form>
      <fieldset className="field-map__providers">
        <legend>Источник снимка</legend>
        {imageryProviders.map(item => <label key={item.id}><input type="radio" name="imagery-provider" value={item.id} checked={providerId === item.id}
          onChange={() => { setImageStatus('loading'); setProviderId(item.id) }} /><span>{item.label}</span></label>)}
      </fieldset>
      <div className="field-map__navigation" role="group" aria-label="Навигация по снимку">
        <button type="button" onClick={() => mapApi.current?.pan(0, .15)} aria-label="На север">↑</button>
        <button type="button" onClick={() => mapApi.current?.pan(-.15, 0)} aria-label="На запад">←</button>
        <button type="button" onClick={() => mapApi.current?.pan(.15, 0)} aria-label="На восток">→</button>
        <button type="button" onClick={() => mapApi.current?.pan(0, -.15)} aria-label="На юг">↓</button>
      </div>
      <p className="map-hint">Видимый участок ≈ {Math.round(viewWidthM)} м по ширине · шаг стрелки ≈ {Math.round(viewWidthM * .15)} м. Дата снимка неизвестна.</p>
      {positionStatus && <p className="map-hint" role="status">{positionStatus}</p>}
    </>}
    {actionError && <p className="map-error" role="alert">{actionError}</p>}
  </section>

  return children ? children(surface, footer) : <>{surface}{footer}</>
}
