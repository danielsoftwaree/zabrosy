import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { Crosshair } from '@phosphor-icons/react/dist/csr/Crosshair'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { Button, Sheet } from '../../shared/ui'
import { requestSensorPermissions, relativeAngle, cameraPlaneHeading } from '../../shared/platform/sensors'
import { useDeviceReadings } from '../../shared/platform/use-device-readings'
import { useXrRange } from './use-xr-range'
import type { XrRangeCapture } from './xr-range'
import './camera.css'

type Props = { targetBearing: number | null; referenceBearing: number | null; targetDistance?: number | null; active: boolean; onChooseMap?: () => void }
const LAST_RANGE_KEY = 'marker:last-xr-range'
type StoredRange = { version: 1; capture: XrRangeCapture }

function readLastRange(): XrRangeCapture | null {
  if (typeof window === 'undefined') return null
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(LAST_RANGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('capture' in value)) return null
    const capture = value.capture
    if (!capture || typeof capture !== 'object' || !('distanceM' in capture) || !('measuredAt' in capture) || !('source' in capture)) return null
    if (typeof capture.distanceM !== 'number' || !Number.isFinite(capture.distanceM) || capture.distanceM <= 0 ||
      typeof capture.measuredAt !== 'number' || !Number.isFinite(capture.measuredAt) || capture.measuredAt <= 0 || capture.measuredAt > Date.now() + 60_000 ||
      (capture.source !== 'surface' && capture.source !== 'water-plane')) return null
    if (capture.source === 'water-plane' && (!('waterLevelY' in capture) || !('heightM' in capture) || capture.waterLevelY === undefined || capture.heightM === undefined)) return null
    if ('waterLevelY' in capture && capture.waterLevelY !== undefined && (typeof capture.waterLevelY !== 'number' || !Number.isFinite(capture.waterLevelY))) return null
    if ('heightM' in capture && capture.heightM !== undefined && (typeof capture.heightM !== 'number' || !Number.isFinite(capture.heightM) || capture.heightM < 0.2)) return null
    return capture as XrRangeCapture
  } catch { return null }
}

const metres = (value: number) => `${value < 10 ? Number(value.toFixed(1)).toLocaleString('ru-RU') : Math.round(value)} м`
const origin = (source: XrRangeCapture['source']) => source === 'water-plane' ? 'по уровню воды, уточнённому у берега' : 'до распознанной поверхности'

export function CameraView({ targetBearing, referenceBearing, targetDistance = null, active, onChooseMap }: Props) {
  const xr = useXrRange(active)
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null)
  const overlayRoot = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const requestId = useRef(0)
  const live = useRef(false)
  const [camera, setCamera] = useState<'off' | 'requesting' | 'on' | 'denied'>('off')
  const [sensor, setSensor] = useState<'off' | 'on' | 'denied'>('off')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualBearing, setManualBearing] = useState(0)
  const [alphaZero, setAlphaZero] = useState<number | null>(null)
  const [lastRange, setLastRange] = useState(readLastRange)
  const [savedInSession, setSavedInSession] = useState<XrRangeCapture | null>(null)
  const reading = useDeviceReadings(active && sensor === 'on', false).orientation?.value ?? null

  useEffect(() => {
    const hostTimer = window.setTimeout(() => setOverlayHost(document.body), 0)
    live.current = true
    const release = () => {
      requestId.current++
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
      if (video.current) video.current.srcObject = null
      setCamera('off')
    }
    const onVisibility = () => { if (document.hidden) release() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearTimeout(hostTimer); live.current = false; document.removeEventListener('visibilitychange', onVisibility); release() }
  }, [])

  function stopPreview() {
    requestId.current++
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCamera('off')
  }

  async function startPreview() {
    const id = ++requestId.current
    setCamera('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' } } })
      if (!live.current || id !== requestId.current || !active || document.hidden) { next.getTracks().forEach(track => track.stop()); return }
      const facing = next.getVideoTracks()[0]?.getSettings?.().facingMode
      if (facing && facing !== 'environment') { next.getTracks().forEach(track => track.stop()); throw new Error('rear camera required') }
      stream.current = next
      next.getVideoTracks()[0]?.addEventListener('ended', stopPreview, { once: true })
      if (video.current) { video.current.srcObject = next; await video.current.play() }
      if (live.current && id === requestId.current) setCamera('on')
    } catch { if (live.current && id === requestId.current) { stopPreview(); setCamera('denied') } }
  }

  async function startSensor() {
    const permission = await requestSensorPermissions()
    if (!live.current) return
    setSensor(permission.orientation === 'granted' ? 'on' : 'denied')
    if (permission.orientation === 'granted') setSettingsOpen(false)
  }

  function saveRange() {
    const capture = xr.capture()
    if (!capture) return
    setLastRange(capture)
    setSavedInSession(capture)
    try { window.sessionStorage.setItem(LAST_RANGE_KEY, JSON.stringify({ version: 1, capture } satisfies StoredRange)) } catch { /* The visible result remains available. */ }
  }

  const planeHeading = reading ? cameraPlaneHeading(reading.alpha, reading.beta, reading.gamma) : null
  const relativeTurn = alphaZero !== null && planeHeading !== null ? relativeAngle(planeHeading, alphaZero) : null
  const turn = sensor === 'on' ? relativeTurn : manualBearing
  const targetOffset = targetBearing !== null && referenceBearing !== null && turn !== null
    ? relativeAngle(targetBearing, referenceBearing + turn) : null
  const targetLabel = targetOffset !== null ? `Цель ${Math.round(Math.abs(targetOffset))}° ${targetOffset < 0 ? 'левее' : 'правее'} центра` : null
  const xrOpen = xr.phase !== 'off'

  return <div className="map-camera">
    <div className={`camera-stage camera-stage--${camera}`}>
      <div className="camera-stage__viewfinder">
        <video ref={video} autoPlay muted playsInline aria-label="Изображение с камеры для наведения" />
        <div className="camera-stage__top">
          <div className="camera-stage__readouts">
            {targetLabel && <span className="camera-stage__target">{targetLabel}</span>}
            {targetDistance !== null && Number.isFinite(targetDistance) && <span className="camera-stage__map-distance">До выбранной цели по карте · {metres(targetDistance)}</span>}
          </div>
          <button type="button" className="camera-stage__tool" aria-label="Настройки наведения" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={21} aria-hidden="true" /></button>
        </div>
        {camera === 'on' && <svg className="camera-stage__cross" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8v32M8 24h32" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}
        {(camera === 'off' || camera === 'denied') && <div className="camera-stage__prompt"><Camera size={34} aria-hidden="true" />
          <p>{camera === 'denied' ? 'Камера недоступна. Проверьте разрешение и повторите.' : xr.support === 'unsupported' ? 'Расстояние можно определить по снимку.' : 'Наведите камеру на точку, до которой хотите узнать расстояние.'}</p></div>}
      </div>
      <div className="camera-stage__actions">
        {xr.support === 'checking' && <p className="camera-stage__hint" role="status">Проверяем возможность измерения…</p>}
        {xr.support === 'supported' && <Button type="button" onClick={() => { stopPreview(); setSavedInSession(null); if (overlayRoot.current) void xr.start(overlayRoot.current) }}>Измерить камерой</Button>}
        {xr.support === 'unsupported' && <p className="camera-stage__hint" role="status">Этот браузер не передаёт расстояние до объектов.</p>}
        {xr.phase === 'off' && xr.issue && <p className="camera-stage__hint" role="alert">{xr.issue}</p>}
        {xr.support === 'unsupported' && onChooseMap && <Button type="button" onClick={onChooseMap}>Выбрать на снимке</Button>}
        {camera === 'on' ? <Button tone="quiet" type="button" onClick={stopPreview}>Выключить камеру</Button>
          : camera === 'requesting' ? <Button tone="quiet" type="button" onClick={stopPreview}>Отменить запрос камеры</Button>
            : <Button tone="quiet" type="button" onClick={startPreview}>Включить камеру</Button>}
        {xr.support === 'unsupported' && <small className="camera-stage__hint">Камера только для наведения.</small>}
        {xr.support !== 'unsupported' && onChooseMap && <button type="button" className="camera-stage__link" onClick={onChooseMap}>Выбрать на снимке</button>}
      </div>
    </div>
    {lastRange && <div className="camera-last-range" role="status"><span>Последний сохранённый замер</span><strong>≈{metres(lastRange.distanceM)}</strong>
      <small>Горизонтальное расстояние · {origin(lastRange.source)} · {new Date(lastRange.measuredAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></div>}
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="Настройки наведения">
      <div className="camera-sheet">
        <p className="camera-sheet__state">{sensor === 'on' ? 'Ориентация включена' : sensor === 'denied' ? 'Датчик недоступен · ручное наведение' : 'Ручное наведение'}</p>
        {sensor !== 'on' ? <Button tone="quiet" type="button" onClick={startSensor}>Включить ориентацию</Button>
          : <Button tone="quiet" type="button" onClick={() => { setSensor('off'); setAlphaZero(null) }}>Ручное наведение</Button>}
        <details className="camera-sheet__guidance"><summary>Наведение на цель по карте</summary>
          {sensor === 'on' && (planeHeading === null || alphaZero === null) && <p className="map-hint" role="status">{planeHeading === null ? 'Нет свежего направления камеры. Держите телефон вертикально.' : 'Наведите камеру на сохранённый ориентир и подтвердите совмещение.'}</p>}
          {sensor === 'on' && referenceBearing !== null && planeHeading !== null && <Button tone="quiet" type="button" onClick={() => setAlphaZero(planeHeading)}><Crosshair size={18} aria-hidden="true" />Совместить с ориентиром</Button>}
          {referenceBearing !== null && sensor !== 'on' && <label className="camera-sheet__manual">Поворот от ориентира вручную: {manualBearing}°<input type="range" min="-180" max="180" value={manualBearing} onChange={event => setManualBearing(Number(event.target.value))} /></label>}
          <p className="map-hint">{targetBearing === null ? 'Для наведения по карте сохраните станцию и цель. ' : referenceBearing === null ? 'Для ручного наведения сохраните ориентир на снимке. ' : ''}Направление приблизительное и не привязывает цель к пикселю воды.</p>
        </details>
      </div>
    </Sheet>
    {overlayHost && createPortal(<div ref={overlayRoot} className={`camera-xr${xrOpen ? ' camera-xr--open' : ''}`} aria-hidden={!xrOpen}>
      {xrOpen && <><div className="camera-xr__top"><span>Измерение камерой</span><button type="button" onClick={xr.stop}>Закрыть</button></div>
        <div className="camera-xr__cross" aria-hidden="true" />
        <div className="camera-xr__bottom" aria-live="polite">
          {xr.phase === 'requesting' ? <p>Открываем измерение…</p> : xr.phase === 'shore' ? <>
            <p>Покажите границу берега и воды поблизости.</p>
            {xr.issue && <p className="camera-xr__issue">{xr.issue}</p>}
            <button type="button" className="camera-xr__primary" disabled={!xr.shoreReady} onClick={xr.confirmShore}>Это граница воды</button>
            <button type="button" className="camera-xr__secondary" onClick={xr.cancelShore}>Отмена</button>
          </> : <>
            {xr.result ? <><span>{xr.result.source === 'surface' ? 'До поверхности по горизонтали' : 'По уровню воды'}</span><strong>≈{metres(xr.result.distanceM)}</strong></>
              : <p>{xr.issue ?? 'До этой точки пока нет надёжной оценки. Удерживайте прицел неподвижно.'}</p>}
            {savedInSession && <small role="status">Сохранено ≈{metres(savedInSession.distanceM)}</small>}
            {xr.result && <button type="button" className="camera-xr__primary" onClick={saveRange}>Сохранить расстояние</button>}
            {!xr.result && onChooseMap && <button type="button" className="camera-xr__primary" onClick={() => { xr.stop(); onChooseMap() }}>Выбрать на снимке</button>}
            <button type="button" className="camera-xr__secondary" onClick={() => { setSavedInSession(null); xr.beginShore() }}>Уточнить по берегу</button>
          </>}
          {xr.issue && xr.result && <p className="camera-xr__issue">{xr.issue}</p>}
        </div></>}
    </div>, overlayHost)}
  </div>
}
