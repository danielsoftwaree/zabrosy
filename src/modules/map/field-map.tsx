import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Gps } from '@phosphor-icons/react/dist/csr/Gps'
import { Target } from '@phosphor-icons/react/dist/csr/Target'
import { Plus } from '@phosphor-icons/react/dist/csr/Plus'
import { Minus } from '@phosphor-icons/react/dist/csr/Minus'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { Accordion, Button } from '../../shared/ui'
import { Ruler } from '@phosphor-icons/react/dist/csr/Ruler'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp'
import { ArrowDown } from '@phosphor-icons/react/dist/csr/ArrowDown'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { useMapTools } from './map-tools'
import { validQuad } from './photo-geometry'
import { useFieldUi } from '../../shared/ui/field-ui'
import { useFieldStore } from '../../shared/storage'
import type { Coordinate, FieldData, Session } from '../../shared/model'
import { newSession } from '../survey'
import { BottomView, observedDepths } from './bottom'
import { DepthSources } from './depth-sources'
import { useEncChart } from './enc-chart-store'
import { areaAt } from './enc-chart'
import { CameraView } from './camera'
import { CanvasMap, type CanvasMapApi, type CanvasMapView, type MapImageStatus } from './canvas-map'
import { imageryProviders } from './imagery-providers'
import { CEGIELINKA, bearingDegrees, distanceMeters, localMeters } from './geometry'
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
  const tools = useMapTools()
  const openedEnc = useEncChart(state => state.chart)
  const enc = tools.dataset === 'enc-current' ? openedEnc : null
  const drawer = useFieldUi(state => state.drawer)
  const setDrawer = useFieldUi(state => state.setDrawer)
  const [internalView, setInternalView] = useState<View>('aerial')
  const activeView = controlledView ?? internalView
  const embedded = Boolean(children)
  const mapApi = useRef<CanvasMapApi | null>(null)
  const mapView = useRef<CanvasMapView | null>(null)
  const [mapCenter, setMapCenter] = useState<Coordinate>(CEGIELINKA)
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
  const targetDistance = station && target ? distanceMeters(station, target) : null
  const selectedChart = data.charts.find(chart => chart.id === tools.dataset)
  const depthPoints = enc ? [] : selectedChart ? selectedChart.points.map(point => ({ position: point.position, meters: point.depthM })) : observedDepths(visibleCasts)
  const haveDepthLayer = Boolean(enc || depthPoints.length)
  const candidateArea = enc && candidate ? areaAt(enc, candidate) : null
  const targetArea = enc && target ? areaAt(enc, target) : null


  function showMap() {
    setDrawer('survey')
    if (embedded) useFieldUi.getState().setView('aerial')
    else setInternalView('aerial')
  }
  function startTool(mode: 'distance' | 'photo') {
    const origin = station ?? tools.photoOrigin ?? (tools.mode === 'distance' ? tools.points[0] : null)
    tools.start(mode === 'photo' && !origin ? 'distance' : mode, origin ?? null)
    setCandidate(null)
    showMap()
  }
  function showCamera() {
    tools.finish()
    setDrawer('survey')
    if (embedded) useFieldUi.getState().setView('camera')
    else setInternalView('camera')
  }
  const areaValid = tools.points.length === 4 && validQuad(tools.points.map(point => {
    const local = localMeters(tools.points[0], point)
    return { x: local.east, y: local.north }
  }))

  function mapTap(point: Coordinate) {
    if ((imageStatus !== 'ready' && !haveDepthLayer) || (locked && !tools.mode)) return
    if (tools.mode) { tools.add(point); return }
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
          <CanvasMap apiRef={mapApi} viewRef={mapView} provider={provider} station={station} referenceBearingDeg={session?.station.referenceBearingDeg ?? null} target={target} casts={visibleCasts} candidate={candidate} toolPoints={tools.mode ? tools.points : tools.anchors} toolMode={tools.mode} encChart={enc} depthPoints={depthPoints} locked={(locked && !tools.mode) || (imageStatus !== 'ready' && !haveDepthLayer)} onPick={mapTap} onStatus={setImageStatus} onWidth={setViewWidthM} onCenter={setMapCenter} />
          {imageStatus !== 'ready' && !haveDepthLayer && <div className="field-map__fallback">{imageStatus === 'error' ? 'Снимок недоступен. Повторите загрузку или введите координаты вручную.' : 'Загружаем снимок…'}</div>}
        </div>
        <div className="map-panel__top-shade" aria-hidden="true" />
        <div className="map-panel__info"><strong>{provider.id === 'gugik-high' ? 'Geoportal · снимок' : provider.label}</strong>
          <p>{imageStatus === 'error' ? 'Снимок недоступен · координаты вручную' : tools.mode === 'distance' ? 'Отметьте своё место и второй берег' : tools.mode === 'photo' ? 'Отметьте четыре точки кромки воды по порядку' : 'Коснитесь снимка, чтобы выбрать цель'}</p>
          {imageStatus === 'error' && <Button type="button" tone="quiet" className="map-panel__retry" onClick={() => mapApi.current?.retry()}>Повторить загрузку</Button>}
          {enc && <p>{enc.name} · диапазоны глубин от нуля карты</p>}
          {selectedChart && <p>{selectedChart.name} · {selectedChart.verticalDatum}</p>}
          {targetArea && <p>У цели: {targetArea.shallowM ?? '?'}–{targetArea.deepM ?? '?'} м по карте</p>}
          {target && <p className="map-panel__target">Цель {target.lat.toFixed(6)}, {target.lon.toFixed(6)}{targetDistance !== null ? ` · ≈${Math.round(targetDistance)} м от станции` : ''}</p>}
        </div>
        <div className="map-panel__rail" role="group" aria-label="Управление снимком">
          <Button type="button" tone="quiet" onClick={locate} disabled={embedded && locked} aria-label="Моя позиция" title="Моя позиция"><Gps size={21} /></Button>
          <Button type="button" tone="quiet" onClick={() => mapApi.current?.centerAt(station ?? CEGIELINKA)} aria-label="К станции" title="К станции"><Target size={21} /></Button>
          <Button type="button" tone="quiet" onClick={() => startTool('distance')} aria-pressed={tools.mode === 'distance'} aria-label="Измерить между точками" title="Измерить между точками"><Ruler size={21} /></Button>
          <Button type="button" tone="quiet" onClick={() => startTool('photo')} aria-pressed={tools.mode === 'photo'} aria-label="Участок для камеры" title="Участок для камеры"><Camera size={21} /></Button>
          <div className="map-panel__zoom"><Button type="button" tone="quiet" onClick={() => mapApi.current?.zoom(.5)} aria-label="Приблизить"><Plus size={20} /></Button>
            <Button type="button" tone="quiet" onClick={() => mapApi.current?.zoom(2)} aria-label="Отдалить"><Minus size={20} /></Button></div>
          <Button type="button" tone="quiet" onClick={() => { setCandidate(null); setActionError(''); setDrawer('coordinates') }} disabled={embedded && locked} aria-label="Точка и настройки" title="Точка и настройки"><SlidersHorizontal size={21} /></Button>
        </div>
        <div className="map-panel__depth-source"><DepthSources /></div>
        <p className="field-map__source">{provider.attribution}{enc ? ` · ${enc.name}, локальный ENC` : ''}</p>
      </>}
      {activeView === 'camera' && <CameraView key={JSON.stringify(tools.anchors)} active station={tools.photoOrigin ?? station} anchors={tools.anchors}
        onChooseMap={() => startTool('distance')} onPrepareArea={() => startTool('photo')}
        onTarget={point => { showMap(); setCandidate(point); setDrawer('point') }} />}
      {activeView === 'bottom' && <BottomView viewCenter={mapCenter} station={station} target={candidate ?? target} casts={visibleCasts} charts={data.charts} />}
      {loading && <p className="map-panel__status" role="status">Загружаем локальные данные…</p>}
      {error && <p className="map-panel__status map-error" role="alert">{error}</p>}
    </div>
  </section>

  const footer = activeView !== 'aerial' || (!tools.mode && drawer === 'survey') ? null : tools.mode ? <section className="map-footer map-footer--measure" aria-label="Измерение на карте">
    <div className="map-footer__head"><strong>{tools.mode === 'distance' ? 'Между двумя точками' : `Участок для камеры · ${Math.min(4, tools.points.length + 1)} / 4`}</strong><Button tone="quiet" onClick={tools.clear}>Закрыть</Button></div>
    <p className="map-hint">{tools.mode === 'distance' ? tools.points.length === 0 ? 'Коснитесь своего места на берегу — это начало замера.' : tools.points.length === 1 ? 'Теперь отметьте второй берег или любую цель на воде.' : 'Расстояние по карте между точками А и Б.' : ['Ближняя кромка воды: точка слева.', 'Ближняя кромка воды: точка справа.', 'Дальняя кромка воды: точка справа.', 'Дальняя кромка воды: точка слева.'][tools.points.length] ?? 'Выберите эти же четыре точки на фото. Все точки должны лежать на уровне воды.'}</p>
    {tools.mode === 'distance' && tools.points.length === 2 && <strong className="map-footer__distance">≈ {Math.round(distanceMeters(tools.points[0], tools.points[1]))} м</strong>}
    <div className="map-footer__actions"><Button tone="quiet" onClick={tools.undo} disabled={!tools.points.length}>{tools.mode === 'distance' && tools.points.length === 2 ? 'Убрать второй берег' : 'Отменить точку'}</Button>
      {tools.mode === 'distance' && tools.points.length === 2 && <Button onClick={() => { const origin = tools.points[0]; tools.start('photo', origin) }}>Привязать камеру</Button>}
      {tools.mode === 'photo' && tools.points.length === 4 && <Button disabled={!areaValid} onClick={showCamera}>Перейти к камере</Button>}</div>
    {tools.mode === 'photo' && tools.points.length === 4 && !areaValid && <p className="map-error">Участок пересекается или слишком узкий. Отмените последнюю точку и выберите шире.</p>}
  </section> : <section className="map-footer" aria-label={drawer === 'point' ? 'Выбранная точка' : 'Координаты и навигация'}>
    <div className="map-footer__handle" aria-hidden="true" />
    <div className="map-footer__head">
      <strong>{drawer === 'point' && candidate ? 'Выбрана точка' : 'Точка и настройки'}</strong>
      <Button type="button" tone="quiet" className="map-footer__back" onClick={() => { setActionError(''); setDrawer('survey') }}>К промеру</Button>
    </div>
    {drawer === 'point' && candidate ? <>
      <p className="map-footer__position">{candidate.lat.toFixed(6)}, {candidate.lon.toFixed(6)}</p>
      {station && <p className="map-footer__distance">От станции ≈ {Math.round(distanceMeters(station, candidate))} м по карте · {Math.round(bearingDegrees(station, candidate))}°</p>}
      {candidateArea && <p className="map-hint">Область по ENC: {candidateArea.shallowM ?? '?'}–{candidateArea.deepM ?? '?'} м. Отсчёт карты: {enc?.verticalDatum}. Это не сегодняшняя глубина в точке.</p>}
      <Button tone="quiet" onClick={() => { if (embedded) useFieldUi.getState().setView('bottom'); else setInternalView('bottom') }}>Посмотреть дно здесь</Button>
      {session ? <div className="map-footer__actions">
        <Button onClick={saveTarget} disabled={!session || locked}>Сохранить цель</Button>
        <Button tone="quiet" onClick={() => setStation(candidate)} disabled={!session || Boolean(data.draft)}>Это станция</Button>
        <Button tone="quiet" onClick={setReference} disabled={!session || !station || Boolean(data.draft)}>Это ориентир</Button>
      </div> : <Button className="map-footer__create" type="button" onClick={createSession}>Создать сессию</Button>}
      {locked && <p className="map-hint">Во время промера цель и привязку менять нельзя.</p>}
    </> : <>
      <Accordion title="Ввести координаты вручную" defaultOpen={imageStatus === 'error'}><form className="field-map__coordinates" onSubmit={chooseCoordinates}>
        <strong>Координаты WGS84</strong>
        <div><label>Широта<input type="text" inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <label>Долгота<input type="text" inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} autoComplete="off" spellCheck={false} /></label></div>
        <Button type="submit" tone="quiet">Выбрать точку</Button>
      </form></Accordion>
      <fieldset className="field-map__providers">
        <legend>Источник снимка</legend>
        {imageryProviders.map(item => <label key={item.id}><input type="radio" name="imagery-provider" value={item.id} checked={providerId === item.id}
          onChange={() => { setImageStatus('loading'); setProviderId(item.id) }} /><span>{item.label}</span></label>)}
      </fieldset>
      <Accordion title="Слой глубин">
        <fieldset className="field-map__providers"><legend>На снимке и в 3D</legend>
          <label><input type="radio" name="map-depth-source" checked={tools.dataset === 'own'} onChange={() => tools.selectDataset('own')} /><span>Мои промеры</span></label>
          {data.charts.map(chart => <label key={chart.id}><input type="radio" name="map-depth-source" checked={tools.dataset === chart.id} onChange={() => tools.selectDataset(chart.id)} /><span>{chart.name}</span></label>)}
          {openedEnc && <label><input type="radio" name="map-depth-source" checked={tools.dataset === 'enc-current'} onChange={() => tools.selectDataset('enc-current')} /><span>{openedEnc.name} · ENC</span></label>}
        </fieldset>
      </Accordion>
      <div className="field-map__navigation" role="group" aria-label="Навигация по снимку">
        <Button type="button" tone="quiet" onClick={() => mapApi.current?.pan(0, .15)} aria-label="На север"><ArrowUp size={20} /></Button>
        <Button type="button" tone="quiet" onClick={() => mapApi.current?.pan(-.15, 0)} aria-label="На запад"><ArrowLeft size={20} /></Button>
        <Button type="button" tone="quiet" onClick={() => mapApi.current?.pan(.15, 0)} aria-label="На восток"><ArrowRight size={20} /></Button>
        <Button type="button" tone="quiet" onClick={() => mapApi.current?.pan(0, -.15)} aria-label="На юг"><ArrowDown size={20} /></Button>
      </div>
      <p className="map-hint">Видимый участок ≈ {Math.round(viewWidthM)} м по ширине · шаг стрелки ≈ {Math.round(viewWidthM * .15)} м. Дата снимка неизвестна.</p>
      {positionStatus && <p className="map-hint" role="status">{positionStatus}</p>}
    </>}
    {actionError && <p className="map-error" role="alert">{actionError}</p>}
  </section>

  return children ? children(surface, footer) : <div className="map-panel-layout">{surface}{footer}</div>
}
