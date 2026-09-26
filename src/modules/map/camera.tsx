import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/ui'
import { requestSensorPermissions, relativeAngle, cameraPlaneHeading } from '../../shared/platform/sensors'
import { useDeviceReadings } from '../../shared/platform/use-device-readings'

type Props = { targetBearing: number | null; referenceBearing: number | null; active: boolean }

export function CameraView({ targetBearing, referenceBearing, active }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const live = useRef(false)
  const requestId = useRef(0)
  const [camera, setCamera] = useState<'off' | 'requesting' | 'on' | 'denied'>('off')
  const [sensor, setSensor] = useState<'off' | 'on' | 'denied'>('off')
  const [manualBearing, setManualBearing] = useState(0)
  const [alphaZero, setAlphaZero] = useState<number | null>(null)
  const reading = useDeviceReadings(active && sensor === 'on', false).orientation?.value ?? null

  function stopCamera() {
    requestId.current += 1
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCamera('off')
  }

  // Media must be released when the page hides or this component unmounts.
  useEffect(() => {
    live.current = true
    const invalidate = () => setAlphaZero(null)
    const onHidden = () => { if (document.hidden) { stopCamera(); invalidate() } }
    window.addEventListener('orientationchange', invalidate)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      live.current = false
      requestId.current += 1
      window.removeEventListener('orientationchange', invalidate)
      document.removeEventListener('visibilitychange', onHidden)
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function startCamera() {
    const id = ++requestId.current
    setCamera('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
      if (!live.current || id !== requestId.current || !active || document.hidden) { next.getTracks().forEach((track) => track.stop()); return }
      stream.current = next
      if (video.current) {
        video.current.srcObject = next
        await video.current.play().catch(() => undefined)
      }
      if (live.current && id === requestId.current) setCamera('on')
    } catch {
      if (live.current && id === requestId.current) setCamera('denied')
    }
  }

  async function startSensor() {
    const permission = await requestSensorPermissions()
    if (live.current) setSensor(permission.orientation === 'granted' ? 'on' : 'denied')
  }

  const planeHeading = reading ? cameraPlaneHeading(reading.alpha, reading.beta, reading.gamma) : null
  const relativeTurn = alphaZero !== null && planeHeading !== null ? relativeAngle(planeHeading, alphaZero) : null
  const turn = sensor === 'on' ? relativeTurn : manualBearing
  const targetOffset = targetBearing !== null && referenceBearing !== null && turn !== null
    ? relativeAngle(targetBearing, referenceBearing + turn) : null

  return <div className="map-camera">
    <div className="map-camera__frame">
      <video ref={video} autoPlay muted playsInline aria-label="Изображение с камеры" />
      <svg className="map-camera__cross" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8v32M8 24h32" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      {camera !== 'on' && <p className="map-camera__placeholder">{camera === 'requesting' ? 'Открываем камеру…' : camera === 'denied' ? 'Камера недоступна. Можно наводиться вручную.' : 'Камера включается по нажатию.'}</p>}
      {targetOffset !== null && <span className="map-camera__angle">Цель {Math.round(Math.abs(targetOffset))}° {targetOffset < 0 ? 'левее' : 'правее'} центра</span>}
    </div>
    <div className="map-camera__actions">
      {camera === 'off' || camera === 'denied' ? <Button onClick={startCamera}>Включить камеру</Button> : <Button tone="quiet" onClick={stopCamera}>{camera === 'requesting' ? 'Отменить запрос камеры' : 'Выключить камеру'}</Button>}
      {sensor !== 'on' ? <Button tone="quiet" onClick={startSensor}>Включить ориентацию</Button> : <Button tone="quiet" onClick={() => { setSensor('off'); setAlphaZero(null) }}>Ручное наведение</Button>}
    </div>
    {sensor === 'on' && referenceBearing !== null && planeHeading !== null &&
      <Button tone="quiet" onClick={() => setAlphaZero(planeHeading)}>Совместить прицел с ориентиром</Button>}
    {sensor === 'on' && (planeHeading === null || alphaZero === null) && <p className="map-hint" role="status">{planeHeading === null ? 'Нет свежего направления камеры. Держите телефон вертикально или используйте ручное наведение.' : 'Наведите камеру на сохранённый ориентир и подтвердите совмещение.'}</p>}
    {referenceBearing !== null && sensor !== 'on' && <label className="map-camera__manual">Поворот от ориентира вручную: {manualBearing}°
      <input type="range" min="-180" max="180" value={manualBearing} onChange={event => setManualBearing(Number(event.target.value))} />
    </label>}
    <p className="map-hint">{sensor === 'denied' ? 'Датчик недоступен. ' : ''}{targetBearing === null ? 'Сначала сохраните станцию и цель. ' : referenceBearing === null ? 'Для ручного наведения сохраните ориентир на снимке. ' : ''}Направление приблизительное. Камера не измеряет расстояние и не привязывает цель к пикселю воды.</p>
  </div>
}
