import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
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
import { ImageryOverlay } from './imagery-overlay'
import { CEGIELINKA, bearingDegrees, coordinateAt, distanceMeters, fromLocalMeters, mapBounds, orthoUrl, type MapBounds } from './geometry'
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
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = useState({ width: 520, height: 520 })
  const frameSizeRef = useRef(frameSize)
  const [center, setCenter] = useState<Coordinate>(CEGIELINKA)
  const [halfSpan, setHalfSpan] = useState(140)
  const [candidate, setCandidate] = useState<Coordinate | null>(null)
  const [latitude, setLatitude] = useState(String(CEGIELINKA.lat))
  const [longitude, setLongitude] = useState(String(CEGIELINKA.lon))
  const [imageRetry, setImageRetry] = useState(0)
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null)
  const [imageResult, setImageResult] = useState<{ key: string; element: HTMLImageElement; status: 'ready' | 'error' } | null>(null)
  const [positionStatus, setPositionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const session = data.sessions.find((item) => item.id === data.activeSessionId) ?? null
  const locked = Boolean(data.draft && data.draft.stage !== 'armed')
  const station = session?.station.position ?? null
  const target = data.draft?.target ?? session?.target ?? null
  const squareBounds = mapBounds(center, halfSpan)
  const verticalSpan = halfSpan * frameSize.height / frameSize.width
  const bounds: MapBounds = { west: squareBounds.west, east: squareBounds.east,
    south: fromLocalMeters(center, 0, -verticalSpan).lat, north: fromLocalMeters(center, 0, verticalSpan).lat }
  const pixelWidth = Math.min(1200, Math.round(1800 * frameSize.width / frameSize.height))
  function imageUrl(resolution: 'HighResolution' | 'StandardResolution') {
    const url = new URL(orthoUrl(bounds, resolution))
    url.searchParams.set('WIDTH', String(pixelWidth))
    url.searchParams.set('HEIGHT', String(Math.round(pixelWidth * frameSize.height / frameSize.width)))
    if (imageRetry) url.searchParams.set('_retry', String(imageRetry))
    return url.toString()
  }
  const highUrl = imageUrl('HighResolution')
  const standardUrl = imageUrl('StandardResolution')
  const imageKey = highUrl
  const imageStatus = imageResult?.key === imageKey && imageResult.element === imageElement ? imageResult.status : 'loading'
  const visibleCasts = data.casts.filter((cast) => cast.sessionId === session?.id && cast.target)
  const targetBearing = station && target ? bearingDegrees(station, target) : null
  const targetDistance = station && target ? distanceMeters(station, target) : null

  useEffect(() => {
    if (activeView !== 'aerial' || !frameRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width))
      const height = Math.max(1, Math.round(entry.contentRect.height))
      if (frameSizeRef.current.width === width && frameSizeRef.current.height === height) return
      frameSizeRef.current = { width, height }
      setFrameSize({ width, height })
    })
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'aerial' || !imageElement) return
    const image = imageElement
    let active = true
    let timer: number | undefined
    function load(src: string, fallback: boolean) {
      let finished = false
      function finish(success: boolean) {
        if (finished || !active) return
        finished = true
        window.clearTimeout(timer)
        image.onload = null
        image.onerror = null
        if (success) setImageResult({ key: imageKey, element: image, status: 'ready' })
        else {
          if (fallback) {
            image.src = 'data:,'
            setImageResult({ key: imageKey, element: image, status: 'error' })
          }
          else load(standardUrl, true)
        }
      }
      image.onload = () => finish(image.naturalWidth > 1 && image.naturalHeight > 1)
      image.onerror = () => finish(false)
      timer = window.setTimeout(() => finish(false), fallback ? 20000 : 8000)
      image.src = src
    }
    load(highUrl, false)
    return () => {
      active = false
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
      image.src = 'data:,'
    }
  }, [activeView, imageElement, highUrl, standardUrl, imageKey])

  function mapTap(event: MouseEvent<HTMLDivElement>) {
    if (locked || imageStatus !== 'ready') return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rectangle.top) / rectangle.height))
    const point = coordinateAt(bounds, x, y)
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
    setCenter(point)
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
      setCenter({ lat: coords.latitude, lon: coords.longitude })
      setLatitude(coords.latitude.toFixed(7))
      setLongitude(coords.longitude.toFixed(7))
      setCandidate(null)
      setPositionStatus(`Положение устройства · точность ±${Math.round(coords.accuracy)} м. Это ещё не сохранённая станция.`)
    }, () => setPositionStatus('Геолокация недоступна. Можно ввести координаты вручную.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  function pan(east: number, north: number) {
    setCenter(fromLocalMeters(center, east * halfSpan, north * halfSpan))
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
        <div ref={frameRef} className="field-map__frame" onClick={mapTap} role="button" tabIndex={0} aria-label="Снимок участка. Коснитесь, чтобы отметить точку" onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && imageStatus === 'ready' && !locked) { event.preventDefault(); setCandidate(center); setLatitude(center.lat.toFixed(7)); setLongitude(center.lon.toFixed(7)); setDrawer('point'); setActionError('') } }}>
          <img key={imageKey} ref={setImageElement} className="field-map__image" alt="Ортофото выбранного участка" referrerPolicy="no-referrer" style={{ visibility: imageStatus === 'ready' ? 'visible' : 'hidden' }} />
          {imageStatus !== 'ready' && <div className="field-map__fallback">{imageStatus === 'error' ? 'Снимок недоступен. Повторите загрузку или введите координаты вручную.' : 'Загружаем снимок…'}</div>}
          <ImageryOverlay bounds={bounds} station={station} referenceBearingDeg={session?.station.referenceBearingDeg ?? null} target={target} casts={visibleCasts} candidate={candidate} />
        </div>
        <div className="map-panel__top-shade" aria-hidden="true" />
        <div className="map-panel__info"><strong>ОРТОФОТО · GUGiK</strong>
          <p>{imageStatus === 'error' ? 'Снимок недоступен · координаты вручную' : 'Выберите точку на снимке · дно здесь не показано'}</p>
          {imageStatus === 'error' && <button type="button" className="map-panel__retry" onClick={() => setImageRetry((attempt) => attempt + 1)}>Повторить загрузку</button>}
          {target && <p className="map-panel__target">Цель {target.lat.toFixed(6)}, {target.lon.toFixed(6)}{targetDistance !== null ? ` · ≈${Math.round(targetDistance)} м от станции` : ''}</p>}
        </div>
        <div className="map-panel__rail" role="group" aria-label="Управление снимком">
          <button type="button" onClick={locate} disabled={embedded && locked} aria-label="Моя позиция" title="Моя позиция"><Gps size={21} /></button>
          <button type="button" onClick={() => setCenter(station ?? CEGIELINKA)} aria-label="К станции" title="К станции"><Target size={21} /></button>
          <div className="map-panel__zoom"><button type="button" onClick={() => setHalfSpan(Math.max(25, halfSpan / 2))} aria-label="Приблизить"><Plus size={20} /></button>
            <button type="button" onClick={() => setHalfSpan(Math.min(2000, halfSpan * 2))} aria-label="Отдалить"><Minus size={20} /></button></div>
          <button type="button" onClick={() => { setCandidate(null); setActionError(''); setDrawer('coordinates') }} disabled={embedded && locked} aria-label="Точка и настройки" title="Точка и настройки"><SlidersHorizontal size={21} /></button>
        </div>
        <p className="field-map__source">Ортофото © <a href="https://www.geoportal.gov.pl/pl/dane/ortofotomapa-orto/" target="_blank" rel="noopener noreferrer">GUGiK / Geoportal</a></p>
      </>}
      {activeView === 'camera' && <CameraView active targetBearing={targetBearing} referenceBearing={session?.station.referenceBearingDeg ?? null} />}
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
      <div className="field-map__navigation" role="group" aria-label="Навигация по снимку">
        <button type="button" onClick={() => pan(0, .3)} aria-label="На север">↑</button>
        <button type="button" onClick={() => pan(-.3, 0)} aria-label="На запад">←</button>
        <button type="button" onClick={() => pan(.3, 0)} aria-label="На восток">→</button>
        <button type="button" onClick={() => pan(0, -.3)} aria-label="На юг">↓</button>
      </div>
      <p className="map-hint">Видимый участок ≈ {Math.round(halfSpan * 2)} м по ширине · шаг стрелки ≈ {Math.round(halfSpan * .3)} м. Дата снимка неизвестна.</p>
      {positionStatus && <p className="map-hint" role="status">{positionStatus}</p>}
    </>}
    {actionError && <p className="map-error" role="alert">{actionError}</p>}
  </section>

  return children ? children(surface, footer) : <>{surface}{footer}</>
}
