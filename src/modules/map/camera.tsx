import { useEffect, useRef, useState } from 'react'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { CameraSlash } from '@phosphor-icons/react/dist/csr/CameraSlash'
import { Crosshair } from '@phosphor-icons/react/dist/csr/Crosshair'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { Button, Sheet } from '../../shared/ui'
import { requestSensorPermissions, relativeAngle, cameraPlaneHeading } from '../../shared/platform/sensors'
import { useDeviceReadings } from '../../shared/platform/use-device-readings'
import { calibratePitch, estimateWaterRange, rearCameraDepression, stablePitch } from './camera-range'
import type { Calibration, PitchSample, RangeResult } from './camera-range'
import './camera.css'

type Props = { targetBearing: number | null; referenceBearing: number | null; targetDistance?: number | null; active: boolean }
type FrozenRange = {
  result: Extract<RangeResult, { valid: true }>
  heightM: number
  calibration: Calibration
  measuredAt: number
}
const LAST_RANGE_KEY = 'marker:last-camera-range'

function readLastRange(): FrozenRange | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(LAST_RANGE_KEY) ?? 'null') as FrozenRange | null
    if (saved?.result?.valid !== true || !saved.calibration ||
      !['horizon', 'known-distance'].includes(saved.calibration.method) ||
      ![saved.measuredAt, saved.heightM, saved.result.distanceM, saved.result.lowerM,
        saved.result.upperM, saved.result.angleToleranceDeg, saved.result.heightToleranceM,
        saved.calibration.offsetDeg, saved.calibration.at, saved.calibration.heightM].every(Number.isFinite) ||
      saved.measuredAt <= 0 || saved.calibration.at <= 0 || saved.heightM <= 0 ||
      saved.result.distanceM <= 0 || saved.result.lowerM <= 0 ||
      saved.result.angleToleranceDeg <= 0 || saved.result.heightToleranceM < 0 ||
      saved.result.upperM < saved.result.lowerM ||
      (saved.calibration.method === 'known-distance' &&
        (!Number.isFinite(saved.calibration.knownDistanceM) || (saved.calibration.knownDistanceM ?? 0) <= 0))) return null
    return saved
  } catch { return null }
}
const metres = (value: number) => `${Math.round(value)} м`
const interval = (lower: number, upper: number) => `${Math.floor(lower)}–${Math.ceil(upper)} м`
const decimal = (value: string) => value.trim() ? Number(value.replace(',', '.')) : NaN
// Event handlers need a wall-clock reading; keep render calculations deterministic.
const currentTime = () => Date.now()

export function CameraView({ targetBearing, referenceBearing, targetDistance = null, active }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const live = useRef(false)
  const requestId = useRef(0)
  const [camera, setCamera] = useState<'off' | 'requesting' | 'on' | 'denied'>('off')
  const [cameraFrame, setCameraFrame] = useState(false)
  const [sensor, setSensor] = useState<'off' | 'on' | 'denied'>('off')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualBearing, setManualBearing] = useState(0)
  const [alphaZero, setAlphaZero] = useState<number | null>(null)
  const [heightText, setHeightText] = useState('')
  const [heightM, setHeightM] = useState<number | null>(null)
  const [heightToleranceText, setHeightToleranceText] = useState('0,1')
  const [knownDistanceText, setKnownDistanceText] = useState('')
  const [calibration, setCalibration] = useState<Calibration | null>(null)
  const [calibrationMode, setCalibrationMode] = useState<'horizon' | 'known-distance' | null>(null)
  const [samples, setSamples] = useState<PitchSample[]>([])
  const [clock, setClock] = useState(() => Date.now())
  const [lastRange, setLastRange] = useState(readLastRange)
  const reading = useDeviceReadings(active && sensor === 'on', false).orientation?.value ?? null

  function stopCamera() {
    requestId.current += 1
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCameraFrame(false)
    setCamera('off')
    setCalibrationMode(null)
    setSamples([])
  }

  // Camera and sensor samples are external resources; release them on hide/unmount.
  useEffect(() => {
    live.current = true
    const invalidate = () => { setAlphaZero(null); setCalibration(null); setCalibrationMode(null); setSamples([]) }
    const onHidden = () => { if (document.hidden) { stopCamera(); invalidate() } }
    window.addEventListener('orientationchange', invalidate)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      live.current = false
      requestId.current += 1
      window.removeEventListener('orientationchange', invalidate)
      document.removeEventListener('visibilitychange', onHidden)
      stream.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!active || sensor !== 'on' || camera !== 'on') return
    let lastAt = 0
    const onOrientation = (event: DeviceOrientationEvent) => {
      const at = Date.now()
      if (document.hidden || at - lastAt < 90) return
      const depressionDeg = rearCameraDepression(event.beta, event.gamma)
      if (depressionDeg === null) return
      lastAt = at
      setSamples(current => [...current.filter(sample => at - sample.at <= 1200), { at, depressionDeg }])
      setClock(at)
    }
    window.addEventListener('deviceorientation', onOrientation)
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => { window.removeEventListener('deviceorientation', onOrientation); window.clearInterval(timer) }
  }, [active, sensor, camera])

  async function startCamera() {
    const id = ++requestId.current
    setCameraFrame(false)
    setCamera('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' } } })
      if (!live.current || id !== requestId.current || !active || document.hidden) { next.getTracks().forEach(track => track.stop()); return }
      const facing = next.getVideoTracks()[0]?.getSettings?.().facingMode
      if (facing && facing !== 'environment') { next.getTracks().forEach(track => track.stop()); throw new Error('rear camera required') }
      stream.current = next
      next.getVideoTracks()[0]?.addEventListener?.('ended', stopCamera, { once: true })
      if (video.current) {
        video.current.srcObject = next
        try { await video.current.play(); if (live.current && id === requestId.current) setCameraFrame(true) }
        catch { /* Guidance can stay available, but range capture requires a playing frame. */ }
      }
      if (live.current && id === requestId.current) setCamera('on')
    } catch {
      if (live.current && id === requestId.current) { stopCamera(); setCamera('denied') }
    }
  }

  async function startSensor() {
    const permission = await requestSensorPermissions()
    if (live.current) {
      setSensor(permission.orientation === 'granted' ? 'on' : 'denied')
      if (permission.orientation === 'granted') setSettingsOpen(false)
    }
  }

  const planeHeading = reading ? cameraPlaneHeading(reading.alpha, reading.beta, reading.gamma) : null
  const relativeTurn = alphaZero !== null && planeHeading !== null ? relativeAngle(planeHeading, alphaZero) : null
  const turn = sensor === 'on' ? relativeTurn : manualBearing
  const targetOffset = targetBearing !== null && referenceBearing !== null && turn !== null
    ? relativeAngle(targetBearing, referenceBearing + turn) : null
  const pitch = stablePitch(samples, clock)
  const heightToleranceM = decimal(heightToleranceText)
  const range = pitch.ready && calibration && heightM !== null
    ? estimateWaterRange({ rawDepressionDeg: pitch.depressionDeg, spreadDeg: pitch.spreadDeg, heightM, heightToleranceM, calibration }) : null
  const canMeasure = camera === 'on' && cameraFrame && sensor === 'on' && !!range?.valid && calibrationMode === null
  const status = camera !== 'on' ? 'Включите заднюю камеру'
    : !cameraFrame ? 'Нет изображения с камеры'
      : sensor !== 'on' ? 'Включите ориентацию в настройках'
        : heightM === null ? 'Укажите высоту объектива над водой'
          : !calibration && !calibrationMode ? 'Откалибруйте наклон в настройках'
            : !pitch.ready ? pitch.reason === 'moving' ? 'Держите телефон неподвижно' : pitch.reason === 'stale' ? 'Нет свежего наклона' : 'Удерживайте прицел неподвижно'
              : range && !range.valid ? range.reason === 'above-water' ? 'Прицел выше плоскости воды' : range.reason === 'too-steep' ? 'Прицел слишком круто вниз' : 'У горизонта ошибка слишком велика' : null

  function confirmHeight() {
    const next = decimal(heightText)
    if (!Number.isFinite(next) || next < 0.2 || next > 100 || !Number.isFinite(heightToleranceM) || heightToleranceM < 0 || heightToleranceM >= next) return
    setHeightM(next)
    setCalibration(null)
    setCalibrationMode(null)
  }

  function beginCalibration(method: 'horizon' | 'known-distance') {
    if (heightM === null || camera !== 'on' || !cameraFrame || sensor !== 'on') return
    if (method === 'known-distance' && (!Number.isFinite(decimal(knownDistanceText)) || decimal(knownDistanceText) <= 0)) return
    setCalibrationMode(method)
    setSettingsOpen(false)
  }

  function captureCalibration() {
    const freshPitch = stablePitch(samples, currentTime())
    if (!freshPitch.ready || heightM === null || !calibrationMode || camera !== 'on' || !cameraFrame || sensor !== 'on') return
    const next = calibratePitch(freshPitch.depressionDeg, heightM, calibrationMode, currentTime(),
      calibrationMode === 'known-distance' ? decimal(knownDistanceText) : undefined)
    if (next) { setCalibration(next); setCalibrationMode(null) }
  }

  function captureRange() {
    const at = currentTime()
    const freshPitch = stablePitch(samples, at)
    if (!canMeasure || !freshPitch.ready || heightM === null || !calibration) return
    const freshRange = estimateWaterRange({ rawDepressionDeg: freshPitch.depressionDeg,
      spreadDeg: freshPitch.spreadDeg, heightM, heightToleranceM, calibration })
    if (!freshRange.valid) return
    const frozen: FrozenRange = { result: freshRange, heightM, calibration, measuredAt: at }
    setLastRange(frozen)
    try { window.sessionStorage.setItem(LAST_RANGE_KEY, JSON.stringify(frozen)) } catch { /* The visible capture still works. */ }
  }

  const frameLabel = camera === 'off' ? 'Камера выключена' : camera === 'requesting' ? 'Открываем камеру…' : camera === 'denied' ? 'Камера недоступна' : 'Камера включена'
  const targetLabel = targetOffset !== null ? `Цель ${Math.round(Math.abs(targetOffset))}° ${targetOffset < 0 ? 'левее' : 'правее'} центра` : null

  return <div className="map-camera">
    <div className={`camera-stage camera-stage--${camera}`}>
      <div className="camera-stage__viewfinder">
        <video ref={video} autoPlay muted playsInline aria-label="Изображение с камеры" />
        <div className="camera-stage__top">
          <div className="camera-stage__readouts"><span className="camera-stage__label" role="status">{frameLabel}</span>
            {targetLabel && <span className="camera-stage__target">{targetLabel}</span>}
            {targetDistance !== null && Number.isFinite(targetDistance) && <span className="camera-stage__map-distance">До выбранной цели по карте · {metres(targetDistance)}</span>}
          </div>
          <div className="camera-stage__tools">
            {sensor === 'on' && referenceBearing !== null && planeHeading !== null &&
              <button type="button" className="camera-stage__tool" aria-label="Совместить прицел с ориентиром" title="Совместить прицел с ориентиром" onClick={() => setAlphaZero(planeHeading)}><Crosshair size={21} aria-hidden="true" /></button>}
            <button type="button" className="camera-stage__tool" aria-label="Настройки наведения" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={21} aria-hidden="true" /></button>
          </div>
        </div>
        {camera === 'on' ? <svg className="camera-stage__cross" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8v32M8 24h32" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          : camera !== 'requesting' && <div className="camera-stage__prompt">
            <p>{camera === 'denied' ? 'Камера недоступна. Можно наводиться вручную.' : 'Камера включается по нажатию.'}</p>
            <Button type="button" onClick={startCamera}><Camera size={20} aria-hidden="true" />Включить камеру</Button>
          </div>}
      </div>
      {camera === 'on' ?
        <div className="camera-stage__range" aria-live="polite">
          {calibrationMode ? <>
            <p className="camera-stage__range-help">{calibrationMode === 'horizon' ? 'Наведите крест на видимый горизонт воды' : 'Наведите крест на точку воды с указанной дистанцией'}</p>
            <button type="button" className="camera-stage__range-action" disabled={!pitch.ready || !cameraFrame} onClick={captureCalibration}>Зафиксировать калибровку</button>
            {!pitch.ready && <small>{status}</small>}
            <button type="button" className="camera-stage__cancel" onClick={() => setCalibrationMode(null)}>Отменить калибровку</button>
          </> : <>
            {canMeasure && range?.valid ? <div className="camera-stage__range-values"><span>Оценка до точки под прицелом</span><strong>≈{metres(range.distanceM)}</strong><small>При допущениях: {interval(range.lowerM, range.upperM)}</small></div>
              : <p className="camera-stage__range-help" role="status">{status}</p>}
            {canMeasure ? <button type="button" className="camera-stage__range-action" onClick={captureRange}>Зафиксировать оценку</button>
              : <button type="button" className="camera-stage__range-action" onClick={() => setSettingsOpen(true)}>Настроить дальномер</button>}
          </>}
          <button type="button" className="camera-stage__control" onClick={stopCamera}><CameraSlash size={18} aria-hidden="true" />Выключить камеру</button>
        </div>
        : camera === 'requesting' && <button type="button" className="camera-stage__control" onClick={stopCamera}>Отменить запрос камеры</button>}
    </div>
    {lastRange && <div className="camera-last-range">
      <div><span>Последняя оценка до точки под прицелом</span><strong>≈{metres(lastRange.result.distanceM)}</strong></div>
      <small>Интервал {interval(lastRange.result.lowerM, lastRange.result.upperM)} · высота {lastRange.heightM.toString().replace('.', ',')} м · {new Date(lastRange.measuredAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
      <p>{interval(lastRange.result.lowerM, lastRange.result.upperM)} при допущении ±{lastRange.result.angleToleranceDeg.toFixed(1).replace('.', ',')}° и ±{lastRange.result.heightToleranceM.toString().replace('.', ',')} м. Высота {lastRange.heightM.toString().replace('.', ',')} м; {lastRange.calibration.method === 'horizon' ? 'калибровка по горизонту' : `калибровка по известной дистанции ${metres(lastRange.calibration.knownDistanceM ?? 0)}`}; {new Date(lastRange.measuredAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}. Это расчёт, не измерение LiDAR.</p>
    </div>}
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="Настройки наведения">
      <div className="camera-sheet">
        <p className="camera-sheet__state">{sensor === 'on' ? 'Ориентация включена' : sensor === 'denied' ? 'Датчик недоступен · ручное наведение' : 'Ручное наведение'}</p>
        {sensor !== 'on' ? <Button tone="quiet" type="button" onClick={startSensor}>Включить ориентацию</Button>
          : <Button tone="quiet" type="button" onClick={() => { setSensor('off'); setAlphaZero(null); setCalibration(null); setCalibrationMode(null) }}>Ручное наведение</Button>}
        <h3>Оценка дальности до воды</h3>
        <p className="map-hint">Нужны задняя камера, горизонтальная водная поверхность и высота <b>объектива над уровнем воды</b>, а не над землёй. Цель должна быть точкой на воде под крестом.</p>
        <label className="camera-sheet__field">Высота объектива над водой, м
          <input type="text" inputMode="decimal" value={heightText} placeholder="Например, 1,5" onChange={event => { setHeightText(event.target.value); setHeightM(null); setCalibration(null) }} />
        </label>
        <label className="camera-sheet__field">Допуск высоты ±, м
          <input type="text" inputMode="decimal" value={heightToleranceText} onChange={event => { setHeightToleranceText(event.target.value); setCalibration(null) }} />
        </label>
        <Button tone="quiet" type="button" disabled={!Number.isFinite(decimal(heightText)) || decimal(heightText) < 0.2 || decimal(heightText) > 100 || !Number.isFinite(heightToleranceM) || heightToleranceM < 0 || heightToleranceM >= decimal(heightText)} onClick={confirmHeight}>Подтвердить высоту над водой</Button>
        {heightM !== null && <p className="camera-sheet__state">Высота подтверждена: {heightM.toString().replace('.', ',')} м. {calibration ? 'Наклон откалиброван.' : 'Теперь откалибруйте наклон.'}</p>}
        <div className="camera-sheet__calibration">
          <label className="camera-sheet__field">Известная горизонтальная дистанция до точки воды, м
            <input type="text" inputMode="decimal" value={knownDistanceText} placeholder="Например, 12" onChange={event => { setKnownDistanceText(event.target.value); setCalibration(null) }} />
          </label>
          <Button tone="quiet" type="button" disabled={heightM === null || sensor !== 'on' || camera !== 'on' || !cameraFrame || !Number.isFinite(decimal(knownDistanceText)) || decimal(knownDistanceText) <= 0} onClick={() => beginCalibration('known-distance')}>По известной дистанции</Button>
          <p className="map-hint">Дальний берег реки — не горизонт. Если горизонт воды не виден, используйте точку воды с известной дистанцией.</p>
          <Button tone="quiet" type="button" disabled={heightM === null || sensor !== 'on' || camera !== 'on' || !cameraFrame} onClick={() => beginCalibration('horizon')}>По видимому горизонту воды</Button>
        </div>
        <p className="map-hint">После выбора калибровки лист закроется: совместите крест с горизонтом воды или известной точкой и нажмите фиксацию в кадре. Угол считается по датчику корпуса; предполагаемый допуск ±2° плюс дрожание. Интервал — проверка чувствительности, не паспортная точность телефона. Калибровка по карте делает две оценки зависимыми.</p>
        <details className="camera-sheet__guidance">
          <summary>Наведение на цель по карте</summary>
          {sensor === 'on' && (planeHeading === null || alphaZero === null) && <p className="map-hint" role="status">{planeHeading === null ? 'Нет свежего направления камеры. Держите телефон вертикально или используйте ручное наведение.' : 'Наведите камеру на сохранённый ориентир и подтвердите совмещение.'}</p>}
          {referenceBearing !== null && sensor !== 'on' && <label className="camera-sheet__manual">Поворот от ориентира вручную: {manualBearing}°
            <input type="range" min="-180" max="180" value={manualBearing} onChange={event => setManualBearing(Number(event.target.value))} />
          </label>}
          <p className="map-hint">{sensor === 'denied' ? 'Датчик недоступен. ' : ''}{targetBearing === null ? 'Для наведения по карте сохраните станцию и цель. ' : referenceBearing === null ? 'Для ручного наведения по карте сохраните ориентир на снимке. ' : ''}Направление приблизительное и не привязывает цель к пикселю воды.</p>
        </details>
      </div>
    </Sheet>
  </div>
}
