import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { Gps } from '@phosphor-icons/react/dist/csr/Gps'
import { Target } from '@phosphor-icons/react/dist/csr/Target'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Minus } from '@phosphor-icons/react/dist/csr/Minus'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { Button } from '../../shared/ui'
import { useFieldStore } from '../../shared/storage'
import type { Coordinate, FieldData, Session } from '../../shared/model'
import { BottomView } from './bottom'
import { CameraView } from './camera'
import { CEGIELINKA, bearingDegrees, coordinateAt, distanceMeters, fromLocalMeters, locationPercent, mapBounds, orthoUrl, type MapBounds } from './geometry'
import { relativeAngle } from '../../shared/platform/sensors'
import './map.css'

type View = 'aerial' | 'camera' | 'bottom'
type Props = { view?: View; embedded?: boolean }
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

function Marker({ bounds, position, kind, title }: { bounds: MapBounds; position: Coordinate; kind: string; title: string }) {
  const { x, y } = locationPercent(bounds, position)
  if (x < 0 || x > 100 || y < 0 || y > 100) return null
  return <span className={`field-map__marker field-map__marker--${kind}`} style={{ left: `${x}%`, top: `${y}%` }} title={title} aria-hidden="true" />
}

export function MapPanel({ view: controlledView, embedded = false }: Props) {
  const { data, loading, error, update } = useFieldStore()
  const [internalView, setInternalView] = useState<View>('aerial')
  const activeView = controlledView ?? internalView
  const [sheetOpen, setSheetOpen] = useState(!embedded)
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = useState({ width: 520, height: 520 })
  const frameSizeRef = useRef(frameSize)
  const [center, setCenter] = useState<Coordinate>(CEGIELINKA)
  const [halfSpan, setHalfSpan] = useState(140)
  const [candidate, setCandidate] = useState<Coordinate | null>(null)
  const [latitude, setLatitude] = useState(String(CEGIELINKA.lat))
  const [longitude, setLongitude] = useState(String(CEGIELINKA.lon))
  const [imageResolution, setImageResolution] = useState<'HighResolution' | 'StandardResolution'>('HighResolution')
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>('loading')
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
  const imageUrl = new URL(orthoUrl(bounds, imageResolution))
  imageUrl.searchParams.set('WIDTH', String(pixelWidth))
  imageUrl.searchParams.set('HEIGHT', String(Math.round(pixelWidth * frameSize.height / frameSize.width)))
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
      setImageStatus('loading')
    })
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [activeView])

  function mapTap(event: MouseEvent<HTMLDivElement>) {
    if (locked || imageStatus !== 'ready') return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rectangle.top) / rectangle.height))
    const point = coordinateAt(bounds, x, y)
    setCandidate(point)
    if (embedded) setSheetOpen(true)
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
    if (embedded) setSheetOpen(true)
    setCenter(point)
    setImageResolution('HighResolution')
    setImageStatus('loading')
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
      if (embedded) setSheetOpen(false)
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Цель не сохранилась. Повторите попытку.') }
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
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Ориентир не сохранился. Повторите попытку.') }
  }

  function locate() {
    if (!navigator.geolocation) { setPositionStatus('Геолокация недоступна. Можно ввести координаты вручную.'); return }
    setPositionStatus('Определяем положение…')
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setCenter({ lat: coords.latitude, lon: coords.longitude })
      setLatitude(coords.latitude.toFixed(7))
      setLongitude(coords.longitude.toFixed(7))
      setCandidate(null)
      setPositionStatus(`Положение устройства · точность ±${Math.round(coords.accuracy)} м. Это ещё не сохранённая станция.`)
      setImageStatus('loading')
      setImageResolution('HighResolution')
    }, () => setPositionStatus('Геолокация недоступна. Можно ввести координаты вручную.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  function pan(east: number, north: number) {
    setCenter(fromLocalMeters(center, east * halfSpan, north * halfSpan))
    setImageStatus('loading')
    setImageResolution('HighResolution')
  }

  return <section className={`map-panel ${embedded ? 'map-panel--embedded' : 'map-panel--standalone'}`} aria-label="Карта участка">
    {!embedded && <div className="map-panel__heading"><h1>Карта участка</h1>
      <div className="map-view-switch" role="group" aria-label="Представление карты">
        <button aria-pressed={activeView === 'aerial'} onClick={() => setInternalView('aerial')}>Снимок</button>
        <button aria-pressed={activeView === 'camera'} onClick={() => setInternalView('camera')}>Камера</button>
        <button aria-pressed={activeView === 'bottom'} onClick={() => setInternalView('bottom')}>Дно</button>
      </div>
    </div>}
    <div className="map-panel__surface">
      {activeView === 'aerial' && <>
        <div ref={frameRef} className="field-map__frame" onClick={mapTap} role="button" tabIndex={0} aria-label="Снимок участка. Коснитесь, чтобы отметить точку" onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && imageStatus === 'ready' && !locked) { event.preventDefault(); setCandidate(center); if (embedded) setSheetOpen(true) } }}>
          {imageStatus !== 'error' && <img className="field-map__image" src={imageUrl.toString()} alt="Ортофото выбранного участка" referrerPolicy="no-referrer" onLoad={() => setImageStatus('ready')} onError={() => { if (imageResolution === 'HighResolution') { setImageResolution('StandardResolution'); setImageStatus('loading') } else setImageStatus('error') }} />}
          {imageStatus !== 'ready' && <div className="field-map__fallback">{imageStatus === 'error' ? 'Снимок недоступен. Откройте точку и введите координаты.' : 'Загружаем снимок…'}</div>}
          {imageStatus === 'ready' && <>{station && <Marker bounds={bounds} position={station} kind="station" title="Станция" />}
            {target && <Marker bounds={bounds} position={target} kind="target" title="Сохранённая цель" />}
            {candidate && <Marker bounds={bounds} position={candidate} kind="candidate" title="Выбранная точка" />}
            {visibleCasts.map((cast) => <Marker key={cast.id} bounds={bounds} position={cast.target!} kind="cast" title="Промер" />)}</>}
        </div>
        <div className="map-panel__top-shade" aria-hidden="true" />
        <div className="map-panel__info"><strong>ОРТОФОТО · GUGiK</strong>
          <p>{imageStatus === 'error' ? 'Снимок недоступен · координаты вручную' : 'Выберите точку на снимке · дно здесь не показано'}</p>
          {target && <p className="map-panel__target">Цель {target.lat.toFixed(6)}, {target.lon.toFixed(6)}{targetDistance !== null ? ` · ≈${Math.round(targetDistance)} м от станции` : ''}</p>}
        </div>
        <div className="map-panel__rail" role="group" aria-label="Управление снимком">
          <button type="button" onClick={locate} aria-label="Моя позиция" title="Моя позиция"><Gps size={21} /></button>
          <button type="button" onClick={() => { setCenter(station ?? CEGIELINKA); setImageStatus('loading') }} aria-label="К станции" title="К станции"><Target size={21} /></button>
          <div className="map-panel__zoom"><button type="button" onClick={() => { setHalfSpan(Math.max(25, halfSpan / 2)); setImageStatus('loading') }} aria-label="Приблизить"><Plus size={20} /></button>
            <button type="button" onClick={() => { setHalfSpan(Math.min(2000, halfSpan * 2)); setImageStatus('loading') }} aria-label="Отдалить"><Minus size={20} /></button></div>
          <button type="button" onClick={() => setSheetOpen(true)} aria-label="Точка и настройки" title="Точка и настройки"><SlidersHorizontal size={21} /></button>
        </div>
        <p className="field-map__source">Ортофото © <a href="https://www.geoportal.gov.pl/pl/dane/ortofotomapa-orto/" target="_blank" rel="noopener noreferrer">GUGiK / Geoportal</a></p>
      </>}
      {activeView === 'camera' && <CameraView active targetBearing={targetBearing} referenceBearing={session?.station.referenceBearingDeg ?? null} />}
      {activeView === 'bottom' && <BottomView station={station} casts={visibleCasts} charts={data.charts} />}
      {loading && <p className="map-panel__status" role="status">Загружаем локальные данные…</p>}
      {error && <p className="map-panel__status map-error" role="alert">{error}</p>}
    </div>
    {activeView === 'aerial' && <details className="map-panel__sheet" open={sheetOpen} onToggle={event => setSheetOpen(event.currentTarget.open)}>
      <summary>{candidate ? 'Выбрана точка · действия' : 'Точка и настройки'} <span aria-hidden="true">{sheetOpen ? '⌄' : '⌃'}</span></summary>
      <div className="map-panel__sheet-content">
        <p className="map-hint">Касание снимка выбирает точку. Дата показанного ортофото неизвестна.</p>
        <form className="field-map__coordinates" onSubmit={chooseCoordinates}>
          <strong>Координаты WGS84</strong>
          <div><label>Широта<input type="text" inputMode="decimal" value={latitude} onChange={event => { setLatitude(event.target.value); setCandidate(null) }} autoComplete="off" spellCheck={false} /></label>
            <label>Долгота<input type="text" inputMode="decimal" value={longitude} onChange={event => { setLongitude(event.target.value); setCandidate(null) }} autoComplete="off" spellCheck={false} /></label></div>
          <Button type="submit" tone="quiet">Выбрать точку</Button>
        </form>
        <div className="field-map__navigation" role="group" aria-label="Навигация по снимку">
          <button onClick={() => pan(0, .3)} aria-label="На север">↑</button>
          <button onClick={() => pan(-.3, 0)} aria-label="На запад">←</button>
          <button onClick={() => pan(.3, 0)} aria-label="На восток">→</button>
          <button onClick={() => pan(0, -.3)} aria-label="На юг">↓</button>
        </div>
        <p className="map-hint">Видимый участок ≈ {Math.round(halfSpan * 2)} м по ширине · шаг стрелки ≈ {Math.round(halfSpan * .3)} м.</p>
        {positionStatus && <p className="map-hint" role="status">{positionStatus}</p>}
        {candidate && <div className="field-map__selection"><strong>Выбрана точка</strong><span>{candidate.lat.toFixed(6)}, {candidate.lon.toFixed(6)}</span>
          {station && <span>От станции ≈ {Math.round(distanceMeters(station, candidate))} м по карте · {Math.round(bearingDegrees(station, candidate))}°</span>}
          <div className="field-map__actions">
            <Button onClick={saveTarget} disabled={!session || locked}>Сохранить цель</Button>
            <Button tone="quiet" onClick={() => setStation(candidate)} disabled={!session || Boolean(data.draft)}>Это станция</Button>
            <Button tone="quiet" onClick={setReference} disabled={!session || !station || Boolean(data.draft)}>Это ориентир</Button>
          </div>
        </div>}
        {!session && <p className="map-hint">Для сохранения точки сначала создайте сессию на экране промера.</p>}
        {locked && <p className="map-hint">Во время промера цель и привязку менять нельзя.</p>}
        {actionError && <p className="map-error" role="alert">{actionError}</p>}
      </div>
    </details>}
  </section>
}
