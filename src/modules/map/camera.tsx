import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { Button } from '../../shared/ui'
import type { Coordinate } from '../../shared/model'
import { distanceMeters } from './geometry'
import { LiveCamera } from './live-camera'
import { AnchorGuide } from './camera-guide'
import { photoProjection, type PhotoPoint } from './photo-geometry'
import { useMapTools } from './map-tools'
import './camera.css'

type Props = {
  active: boolean
  station: Coordinate | null
  anchors: Coordinate[]
  onChooseMap(): void
  onPrepareArea(): void
  onTarget(point: Coordinate): void
}


function PhotoView({ active, station, anchors, onChooseMap, onPrepareArea, onTarget }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const request = useRef(0)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gestureBlocked = useRef(false)
  const [camera, setCamera] = useState<'off' | 'requesting' | 'on'>('off')
  const [zoomed, setZoomed] = useState(false)
  const photo = useMapTools(state => state.photo)
  const points = useMapTools(state => state.photoPoints)
  const pick = useMapTools(state => state.photoPick)
  const setPhoto = useMapTools(state => state.setPhoto)
  const setPoints = useMapTools(state => state.setPhotoPoints)
  const setPick = useMapTools(state => state.setPhotoPick)
  const [issue, setIssue] = useState('')
  const [cursor, setCursor] = useState<PhotoPoint>({ x: .5, y: .5 })
  const project = points.length === 4 ? photoProjection(points, anchors) : null
  const target = pick && project ? project(pick) : null
  const distance = target && station ? distanceMeters(station, target) : null
  const ready = anchors.length === 4 && station !== null

  function stopCamera() {
    request.current++
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCamera('off')
  }
  useEffect(() => {
    const release = () => {
      request.current++
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
      if (video.current) video.current.srcObject = null
    }
    const hide = () => { if (document.hidden) { release(); setCamera('off') } }
    document.addEventListener('visibilitychange', hide)
    return () => { release(); document.removeEventListener('visibilitychange', hide) }
  }, [])
  useEffect(() => {
    if (!active) {
      request.current++
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
    }
  }, [active])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !photo) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      context.drawImage(image, 0, 0, photo.width, photo.height)
      const radius = Math.min(photo.width, photo.height) * .024
      if (points.length) {
        context.beginPath()
        points.forEach((p, index) => { if (index) context.lineTo(p.x * photo.width, p.y * photo.height); else context.moveTo(p.x * photo.width, p.y * photo.height) })
        if (points.length === 4) { context.closePath(); context.fillStyle = '#d8f28522'; context.fill() }
        context.strokeStyle = '#d8f285'; context.lineWidth = radius / 7; context.stroke()
      }
      points.forEach((p, index) => {
        context.beginPath(); context.arc(p.x * photo.width, p.y * photo.height, radius, 0, Math.PI * 2)
        context.fillStyle = '#fbfcf8'; context.fill(); context.strokeStyle = '#18594a'; context.lineWidth = radius / 8; context.stroke()
        context.fillStyle = '#18594a'; context.font = `700 ${radius * 1.25}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'
        context.fillText(String(index + 1), p.x * photo.width, p.y * photo.height)
      })
      if (pick) {
        context.beginPath(); context.arc(pick.x * photo.width, pick.y * photo.height, radius * .7, 0, Math.PI * 2)
        context.fillStyle = '#d8f285'; context.fill(); context.strokeStyle = '#18594a'; context.lineWidth = radius / 6; context.stroke()
      }
    }
    image.src = photo.url
    return () => { cancelled = true }
  }, [photo, points, pick])

  async function startCamera() {
    stopCamera()
    const id = request.current
    setIssue(''); setPhoto(null); setZoomed(false); setCamera('requesting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } } })
      if (id !== request.current || !active || document.hidden) { next.getTracks().forEach(track => track.stop()); return }
      stream.current = next
      next.getVideoTracks()[0]?.addEventListener('ended', stopCamera, { once: true })
      if (video.current) { video.current.srcObject = next; await video.current.play() }
      if (id === request.current) setCamera('on')
    } catch {
      if (id !== request.current) return
      stopCamera(); setIssue('Камера недоступна. Разрешите доступ или нажмите «Сделать / открыть фото».')
    }
  }
  function freeze() {
    const element = video.current
    if (!element?.videoWidth || !element.videoHeight) { setIssue('Дождитесь изображения камеры.'); return }
    const output = document.createElement('canvas')
    output.width = element.videoWidth; output.height = element.videoHeight
    const context = output.getContext('2d')
    if (!context) { setIssue('Не удалось сохранить кадр. Попробуйте открыть фото.'); return }
    context.drawImage(element, 0, 0)
    setPhoto({ url: output.toDataURL('image/jpeg', .92), width: output.width, height: output.height })
    setZoomed(false); setIssue(''); stopCamera()
  }
  async function openPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    stopCamera()
    const id = request.current
    setIssue('')
    if (file.size > 25 * 1024 * 1024) { setIssue('Выберите фото до 25 МБ.'); return }
    const url = URL.createObjectURL(file)
    try {
      const image = new Image(); image.src = url; await image.decode()
      if (id !== request.current) return
      const output = document.createElement('canvas')
      const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight))
      output.width = Math.round(image.naturalWidth * scale); output.height = Math.round(image.naturalHeight * scale)
      const context = output.getContext('2d')
      if (!context || !output.width || !output.height) throw new Error('image')
      context.drawImage(image, 0, 0, output.width, output.height)
      setPhoto({ url: output.toDataURL('image/jpeg', .92), width: output.width, height: output.height })
      setZoomed(false)
    } catch { if (id === request.current) setIssue('Это фото не удалось открыть. Попробуйте JPEG или PNG.') }
    finally { URL.revokeObjectURL(url) }
  }
  function select(point: PhotoPoint) {
    setIssue('')
    if (points.length < 4) setPoints([...points, point])
    else if (project?.(point)) setPick(point)
    else { setPick(null); setIssue('Выберите воду внутри четырёх отмеченных точек.') }
  }
  function tap(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    select({ x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) })
  }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size > 1) gestureBlocked.current = true
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointers.current.get(event.pointerId)
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) gestureBlocked.current = true
  }
  function pointerEnd(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const tracked = pointers.current.has(event.pointerId)
    if (!tracked) return
    pointerMove(event)
    pointers.current.delete(event.pointerId)
    if (!cancelled && !gestureBlocked.current) tap(event)
    if (!pointers.current.size) gestureBlocked.current = false
  }

  return <section className="map-camera" aria-label="Замер по фото">
    {!ready ? <div className="photo-intro"><Camera size={36} aria-hidden="true" /><h2>От снимка к фото</h2>
      <p>Сначала отметьте своё место и второй берег на карте. Расстояние появится сразу.</p>
      <Button onClick={onChooseMap}>Измерить на карте</Button>
      <p>Для выбора точки на фото отметьте четыре узнаваемые точки кромки воды — по две на каждом берегу.</p>
      <Button tone="quiet" onClick={onPrepareArea}>Подготовить участок для фото</Button>
    </div> : <>
      <div className="photo-heading"><strong>{photo ? points.length < 4 ? `Совместите точку ${points.length + 1} из 4` : 'Выберите место на воде' : 'Снимите оба берега'}</strong>
        <Button tone="quiet" onClick={onPrepareArea}>Участок</Button></div>
      <p className="photo-instruction">{!photo ? 'Все четыре точки с карты должны быть видны. Снимайте обычной камерой 1× без панорамы.' : points.length < 4 ? 'Коснитесь той же точки кромки воды, что отмечена на карте. Порядок: ближняя слева → ближняя справа → дальняя справа → дальняя слева.' : 'Кадр зафиксирован. Расчёт действует только на воде внутри отмеченного участка.'}</p>
      <AnchorGuide anchors={anchors} station={station} current={points.length} />
      {photo && <Button tone="quiet" aria-pressed={zoomed} onClick={() => setZoomed(value => !value)}>{zoomed ? 'Уместить фото' : 'Увеличить фото 2×'}</Button>}
      {photo ? <div className="photo-viewport"><canvas ref={canvas} width={photo.width} height={photo.height} className={`photo-canvas${zoomed ? ' photo-canvas--zoomed' : ''}`} tabIndex={0} role="button" aria-label="Фото участка. Отметьте точки кромки воды, затем цель" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onPointerLeave={event => { if (event.pointerType === 'mouse') pointerEnd(event, true) }} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          const movement: Record<string, PhotoPoint> = { ArrowLeft: { x: -.01, y: 0 }, ArrowRight: { x: .01, y: 0 }, ArrowUp: { x: 0, y: -.01 }, ArrowDown: { x: 0, y: .01 } }
          if (movement[event.key]) { event.preventDefault(); const delta = movement[event.key]; const next = { x: Math.max(0, Math.min(1, cursor.x + delta.x)), y: Math.max(0, Math.min(1, cursor.y + delta.y)) }; setCursor(next); setPick(next) }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(cursor) }
        }} /></div> : <div className={`photo-preview photo-preview--${camera}`}><video ref={video} autoPlay playsInline muted aria-label="Изображение с камеры для наведения" />{camera === 'off' && <Camera size={48} aria-hidden="true" />}</div>}
      {points.length === 4 && !project && <p className="photo-error" role="alert">Точки слишком близки, лежат на линии или пересекаются. Отмените последнюю и выберите шире.</p>}
      {issue && <p className="photo-error" role="alert">{issue}</p>}
      {distance !== null && <div className="photo-result" role="status"><strong>≈ {Math.round(distance)} м</strong><span>От вашего места · по привязке фото к карте</span><Button onClick={() => target && onTarget(target)}>Показать цель на карте</Button></div>}
      <div className="photo-actions">
        {photo ? <><Button tone="quiet" onClick={() => { setPoints(points.slice(0, -1)); setIssue('') }} disabled={!points.length}>Отменить точку</Button><Button tone="quiet" onClick={() => { setPhoto(null); setZoomed(false); setIssue('') }}>Новый кадр</Button></>
          : camera === 'on' ? <><Button onClick={freeze}>Зафиксировать кадр</Button><Button tone="quiet" onClick={stopCamera}>Выключить камеру</Button></>
            : camera === 'requesting' ? <Button tone="quiet" onClick={stopCamera}>Отменить запрос камеры</Button> : <Button onClick={startCamera}>Включить камеру</Button>}
        {!photo && camera === 'off' && <label className="button button--quiet photo-file">Сделать / открыть фото<input type="file" accept="image/*" capture="environment" onChange={event => { void openPhoto(event) }} /></label>}
      </div>
      <p className="photo-note">Оценка по плоскости воды. Точность зависит от снимка, выбора одинаковых точек и уровня воды. Глубину и траекторию груза фото не измеряет.</p>
    </>}
  </section>
}

export function CameraView(props: Props) {
  const photo = useMapTools(state => state.photo)
  const [mode, setMode] = useState<'live' | 'photo'>(photo ? 'photo' : 'live')
  const ready = props.anchors.length === 4 && props.station !== null
  return <section className="map-camera camera-container" aria-label="Камера и привязка к карте">
    <div className="camera-mode-controls" aria-label="Режим камеры">
      <Button tone={mode === 'live' ? 'primary' : 'quiet'} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Живая камера</Button>
      <Button tone={mode === 'photo' ? 'primary' : 'quiet'} aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}>Фото</Button>
      {mode === 'live' && ready && <Button className="camera-area-button" tone="quiet" aria-label="Изменить участок" title="Изменить участок" onClick={props.onPrepareArea}><MapTrifold size={21} aria-hidden="true" /></Button>}
    </div>
    {mode === 'photo' ? <PhotoView {...props} /> : ready ? <>
      <LiveCamera active={props.active} station={props.station!} anchors={props.anchors} onTarget={props.onTarget} />
    </> : <div className="photo-intro"><Camera size={36} aria-hidden="true" /><h2>Участок на воде</h2>
      <p>Выберите своё место и участок на снимке, затем совместите его с камерой. На воде появятся линии расстояний от вас.</p>
      <Button onClick={props.onChooseMap}>Выбрать место на карте</Button>
      <p>Для привязки нужны четыре узнаваемые точки у воды: по две на ближней и дальней кромке.</p>
      <Button tone="quiet" onClick={props.onPrepareArea}>Выбрать участок</Button>
    </div>}
  </section>
}
