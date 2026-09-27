import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { Button } from '../../shared/ui'
import type { Coordinate } from '../../shared/model'
import { distanceMeters } from './geometry'
import { photoRegistration, photoDistanceRings, type PhotoPoint } from './photo-geometry'
import { createLiveTracker } from './live-tracking'
import { AnchorGuide } from './camera-guide'
import './live-camera.css'

type Phase = 'off' | 'requesting' | 'preview' | 'align' | 'tracking' | 'lost'
type Props = { active: boolean; station: Coordinate; anchors: Coordinate[]; onTarget(point: Coordinate): void }
type Tracker = NonNullable<ReturnType<typeof createLiveTracker>>

/** Local video registration. The live transform is never saved as a survey measurement. */
export function LiveCamera(props: Props) {
  return props.active ? <LiveCameraSession {...props} /> : null
}

function LiveCameraSession({ station, anchors, onTarget }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const source = useRef<HTMLCanvasElement | null>(null)
  const keyboardCursor = useRef<PhotoPoint | null>(null)
  const small = useRef<HTMLCanvasElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const tracker = useRef<Tracker | null>(null)
  const model = useRef({ phase: 'off' as Phase, points: [] as PhotoPoint[], target: null as Coordinate | null, updated: 0, frameWidth: 0, frameHeight: 0 })
  const drag = useRef<{ id: number; index: number; start: PhotoPoint; moved: boolean } | null>(null)
  const [phase, setPhase] = useState<Phase>('off')
  const [points, setPoints] = useState<PhotoPoint[]>([])
  const [target, setTarget] = useState<Coordinate | null>(null)
  const [issue, setIssue] = useState('')
  const [cursor, setCursor] = useState<PhotoPoint>({ x: .5, y: .5 })
  const registration = points.length === 4 ? photoRegistration(points, anchors) : null

  function changePhase(next: Phase) { model.current.phase = next; setPhase(next) }
  function changePoints(next: PhotoPoint[]) { model.current.points = next; setPoints(next) }
  function clearTarget() { model.current.target = null; setTarget(null) }
  function release() {
    generation.current++
    source.current = null; small.current = null
    const output = canvas.current
    output?.getContext('2d')?.clearRect(0, 0, output.width, output.height)
    tracker.current = null
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }
  function stop() { release(); changePhase('off'); changePoints([]); clearTarget() }
  function lose(message: string) {
    const output = canvas.current, element = video.current
    if (output && element && element.readyState >= 2) output.getContext('2d')?.drawImage(element, 0, 0, output.width, output.height)
    tracker.current = null; clearTarget(); changePhase('lost'); setIssue(message)
  }

  useEffect(() => {
    const element = video.current
    const requestGeneration = generation
    const rotate = () => {
      if (model.current.phase === 'tracking' || model.current.phase === 'align') {
        tracker.current = null; model.current.phase = 'lost'; model.current.target = null
        setTarget(null); setPhase('lost'); setIssue('Положение экрана изменилось. Совместите участок заново.')
        const output = canvas.current
        if (output && element && element.readyState >= 2) output.getContext('2d')?.drawImage(element, 0, 0, output.width, output.height)
      }
    }
    const hide = () => {
      if (!document.hidden) return
      requestGeneration.current++
      source.current = null; small.current = null
      const output = canvas.current
      output?.getContext('2d')?.clearRect(0, 0, output.width, output.height)
      tracker.current = null
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
      if (element) element.srcObject = null
      model.current.phase = 'off'; model.current.points = []; model.current.target = null
      setPhase('off'); setPoints([]); setTarget(null)
      setIssue('Камера остановлена. Включите её и совместите участок заново.')
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('orientationchange', rotate)
    return () => {
      requestGeneration.current++
      tracker.current = null
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
      if (element) element.srcObject = null
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('orientationchange', rotate)
    }
  }, [])

  // Media stream and its frame callbacks are external resources; high-frequency state stays in refs.
  useEffect(() => {
    const element = video.current
    if (!element) return
    let cancelled = false, callback = 0, animation = 0, alignmentAnimation = 0, lastFrame = 0, lastVideoTime = -1
    const supportsFrames = typeof element.requestVideoFrameCallback === 'function'
    const draw = (now: number) => {
      if (cancelled) return
      const state = model.current
      const output = canvas.current
      const context = output?.getContext('2d')
      if (output && context && element.videoWidth && element.readyState >= 2 && now - lastFrame >= 80) {
        lastFrame = now
        const width = Math.min(960, element.videoWidth)
        const height = Math.round(width * element.videoHeight / element.videoWidth)
        if (output.width !== width || output.height !== height) { output.width = width; output.height = height }
        if (state.phase === 'align' && source.current) context.drawImage(source.current, 0, 0, width, height)
        else context.drawImage(element, 0, 0, width, height)
        if (state.phase === 'tracking' && tracker.current && small.current) {
          if (element.videoWidth !== state.frameWidth || element.videoHeight !== state.frameHeight) {
            tracker.current = null; state.phase = 'lost'; state.target = null; setTarget(null); setPhase('lost'); setIssue('Кадр изменился. Совместите участок заново.')
          } else {
            const sample = small.current.getContext('2d', { willReadFrequently: true })
            if (sample) {
              sample.drawImage(element, 0, 0, small.current.width, small.current.height)
              const result = tracker.current.update(sample.getImageData(0, 0, small.current.width, small.current.height), now)
              if (result.status === 'tracked') { state.points = result.corners; state.updated = now }
              else { tracker.current = null; state.phase = 'lost'; state.target = null; setTarget(null); setPhase('lost'); setIssue('Привязка потеряна. Наведите камеру на тот же участок и совместите точки заново.') }
            }
          }
        }
        if (state.phase === 'align' || state.phase === 'tracking') {
          const mark = (point: PhotoPoint, label: string, selected = false) => {
            const x = point.x * width, y = point.y * height
            const radius = width * .025
            context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
            context.fillStyle = selected ? '#d8f285' : '#fbfcf8'; context.fill()
            context.strokeStyle = '#18594a'; context.lineWidth = width / 350; context.stroke()
            context.fillStyle = '#123e34'; context.font = `700 ${width * .031}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'
            context.fillText(label, x, y)
          }
          if (state.points.length) {
            context.beginPath()
            state.points.forEach((p, i) => { if (i) context.lineTo(p.x * width, p.y * height); else context.moveTo(p.x * width, p.y * height) })
            if (state.points.length === 4) { context.closePath(); context.fillStyle = '#d8f28520'; context.fill() }
            context.lineWidth = width / 300; context.strokeStyle = '#d8f285'; context.stroke()
          }
          if (state.phase === 'tracking') {
            const rings = photoDistanceRings(state.points, anchors, station)
            context.font = `600 ${width * .026}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'
            for (const ring of rings) {
              context.beginPath()
              for (const [a, b] of ring.segments) { context.moveTo(a.x * width, a.y * height); context.lineTo(b.x * width, b.y * height) }
              context.strokeStyle = '#efffc7'; context.lineWidth = width / 450; context.stroke()
              const label = ring.segments[Math.floor(ring.segments.length / 2)]?.[0]
              if (label) {
                const text = `≈ ${ring.meters} м`, x = label.x * width, y = label.y * height
                context.fillStyle = '#153f35'; context.fillRect(x - width * .065, y - width * .022, width * .13, width * .044)
                context.fillStyle = '#fff'; context.fillText(text, x, y)
              }
            }
            if (state.target) {
              const position = photoRegistration(state.points, anchors)?.toImage(state.target)
              if (position) mark(position, '+', true)
            }
          } else state.points.forEach((p, i) => mark(p, String(i + 1)))
          if (keyboardCursor.current) mark(keyboardCursor.current, '+')
        }
      }
    }
    const frame = (now: number) => {
      if (cancelled) return
      if (element.currentTime !== lastVideoTime) { lastVideoTime = element.currentTime; draw(now) }
      schedule()
    }
    const schedule = () => {
      if (cancelled) return
      if (supportsFrames) callback = element.requestVideoFrameCallback(frame)
      else animation = requestAnimationFrame(frame)
    }
    const alignmentFrame = (now: number) => {
      if (cancelled) return
      if (model.current.phase === 'align') draw(now)
      alignmentAnimation = requestAnimationFrame(alignmentFrame)
    }
    alignmentAnimation = requestAnimationFrame(alignmentFrame)
    schedule()
    const stale = window.setInterval(() => {
      if (model.current.phase === 'tracking' && performance.now() - model.current.updated > 800) {
        tracker.current = null; model.current.phase = 'lost'; model.current.target = null
        setTarget(null); setPhase('lost'); setIssue('Видео остановилось. Совместите участок заново.')
        const output = canvas.current
        const context = output?.getContext('2d')
        if (context && output && element.readyState >= 2) context.drawImage(element, 0, 0, output.width, output.height)
      }
    }, 250)
    return () => { cancelled = true; clearInterval(stale); if (supportsFrames) element.cancelVideoFrameCallback(callback); cancelAnimationFrame(animation); cancelAnimationFrame(alignmentAnimation) }
  }, [anchors, station])

  async function start() {
    stop(); setIssue(''); changePhase('requesting')
    const id = generation.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } } })
      if (id !== generation.current || document.hidden) { next.getTracks().forEach(track => track.stop()); return }
      stream.current = next
      next.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream.current === next) { stop(); setIssue('Камера отключилась. Включите её заново.') } }, { once: true })
      if (video.current) { video.current.srcObject = next; await video.current.play() }
      if (id === generation.current) changePhase('preview')
    } catch { if (id === generation.current) { stop(); setIssue('Камера недоступна. Разрешите доступ в Safari или переключитесь на «Фото».') } }
  }
  function align() {
    const element = video.current
    if (!element?.videoWidth || element.readyState < 2) { setIssue('Дождитесь изображения камеры.'); return }
    source.current = document.createElement('canvas')
    source.current.width = Math.min(960, element.videoWidth)
    source.current.height = Math.round(source.current.width * element.videoHeight / element.videoWidth)
    source.current.getContext('2d')?.drawImage(element, 0, 0, source.current.width, source.current.height)
    const output = canvas.current
    if (output) output.getContext('2d')?.drawImage(source.current, 0, 0, output.width, output.height)
    model.current.frameWidth = element.videoWidth; model.current.frameHeight = element.videoHeight
    tracker.current = null; clearTarget(); changePoints([]); setIssue(''); changePhase('align')
  }
  function lock() {
    if (!registration || !source.current) return
    small.current = document.createElement('canvas')
    const scale = Math.min(320 / source.current.width, 480 / source.current.height)
    small.current.width = Math.round(source.current.width * scale); small.current.height = Math.round(source.current.height * scale)
    const context = small.current.getContext('2d', { willReadFrequently: true })
    if (!context) { lose('Не удалось обработать видео. Попробуйте режим «Фото».'); return }
    context.drawImage(source.current, 0, 0, small.current.width, small.current.height)
    const element = video.current
    if (!element || element.readyState < 2 || element.videoWidth !== model.current.frameWidth || element.videoHeight !== model.current.frameHeight) { lose('Кадр изменился. Совместите участок заново.'); return }
    const now = performance.now()
    tracker.current = createLiveTracker(model.current.points, context.getImageData(0, 0, small.current.width, small.current.height), now - 1)
    if (!tracker.current) { lose('Недостаточно деталей берега у опорных точек. Выберите камни или углы сооружений у воды; можно использовать «Фото».'); return }
    // Verify the old alignment frame against live video before allowing any measurement.
    context.drawImage(element, 0, 0, small.current.width, small.current.height)
    const checkedAt = performance.now()
    const result = tracker.current.update(context.getImageData(0, 0, small.current.width, small.current.height), checkedAt)
    if (result.status !== 'tracked') { lose('Камера сместилась во время совмещения. Совместите участок заново, удерживая телефон на месте.'); return }
    model.current.points = result.corners; model.current.updated = checkedAt
    const output = canvas.current
    if (output) output.getContext('2d')?.drawImage(element, 0, 0, output.width, output.height)
    clearTarget(); setIssue(''); changePhase('tracking')
  }
  function choose(point: PhotoPoint) {
    const state = model.current
    if (state.phase === 'align' && state.points.length < 4) { changePoints([...state.points, point]); setIssue(''); return }
    if (state.phase !== 'tracking' || performance.now() - state.updated > 800) return
    const next = photoRegistration(state.points, anchors)?.toWorld(point)
    model.current.target = next ?? null; setTarget(next ?? null)
    setIssue(next ? '' : 'Коснитесь воды внутри выделенного участка.')
  }
  function location(event: PointerEvent<HTMLCanvasElement>): PhotoPoint {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }
  }
  const distance = target ? distanceMeters(station, target) : null
  return <div className="live-camera" data-phase={phase}>
    <div className="live-camera-heading"><strong>{phase === 'align' ? points.length < 4 ? `Совместите точку ${points.length + 1} из 4` : 'Проверьте границы участка' : phase === 'tracking' ? 'Привязка удерживается' : phase === 'lost' ? 'Нужно совместить заново' : 'Участок на живой камере'}</strong></div>
    <p className="photo-instruction">{phase === 'align' ? 'На стоп-кадре отметьте те же точки у воды: ближняя слева → справа → дальняя справа → слева. Метки можно передвинуть.' : phase === 'tracking' ? 'Коснитесь воды внутри сетки. Оставайтесь на месте, поворачивайте телефон плавно.' : 'Покажите обе кромки воды обычной камерой 1×. Метры возьмём с карты; детали берега помогут удерживать сетку.'}</p>
    {phase === 'align' && <AnchorGuide anchors={anchors} station={station} current={points.length} />}
    <div className="live-camera-stage">
      <video ref={video} playsInline muted autoPlay aria-label="Живое изображение камеры" />
      <canvas ref={canvas} className="live-camera-canvas" width="640" height="480" tabIndex={0} role="button" aria-label="Живой участок. Совместите точки или выберите цель на воде"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) { drag.current = null; return }
          keyboardCursor.current = null
          const point = location(event)
          const box = event.currentTarget.getBoundingClientRect()
          const index = model.current.phase === 'align' ? model.current.points.findIndex(p => Math.hypot((p.x - point.x) * box.width, (p.y - point.y) * box.height) < 24) : -1
          drag.current = { id: event.pointerId, index, start: point, moved: false }; event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const current = drag.current
          if (!current || current.id !== event.pointerId) return
          const point = location(event)
          if (Math.hypot(point.x - current.start.x, point.y - current.start.y) > .015) current.moved = true
          if (current.index >= 0 && model.current.phase === 'align') changePoints(model.current.points.map((p, i) => i === current.index ? point : p))
        }}
        onPointerUp={event => { const current = drag.current; drag.current = null; if (current?.id === event.pointerId && !current.moved && current.index < 0) choose(location(event)) }}
        onPointerCancel={() => { drag.current = null }} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          const delta: Record<string, PhotoPoint> = { ArrowLeft: { x: -.02, y: 0 }, ArrowRight: { x: .02, y: 0 }, ArrowUp: { x: 0, y: -.02 }, ArrowDown: { x: 0, y: .02 } }
          if (delta[event.key]) { event.preventDefault(); const next = { x: Math.max(0, Math.min(1, cursor.x + delta[event.key].x)), y: Math.max(0, Math.min(1, cursor.y + delta[event.key].y)) }; keyboardCursor.current = next; setCursor(next) }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(cursor) }
        }} />
      {(phase === 'off' || phase === 'requesting') && <div className="live-camera-placeholder"><Camera size={36} aria-hidden="true" /><span>{phase === 'requesting' ? 'Ожидаем разрешение камеры' : 'Камера включается только по нажатию'}</span></div>}
      {phase === 'lost' && <div className="live-camera-status">Замер приостановлен</div>}
    </div>
    {phase === 'align' && points.length === 4 && !registration && <p className="photo-error" role="alert">Точки должны охватывать воду без пересечения сторон. Передвиньте метки или отмените точку.</p>}
    {issue && <p className="photo-error" role="alert">{issue}</p>}
    {phase === 'tracking' && distance !== null && <div className="photo-result" role="status"><strong>≈ {Math.round(distance)} м</strong><span>От вашего места · по привязке к карте</span><Button onClick={() => { if (target && model.current.phase === 'tracking' && performance.now() - model.current.updated <= 800) onTarget(target) }}>Показать цель на карте</Button></div>}
    <div className="photo-actions">
      {phase === 'off' && <Button onClick={() => { void start() }}>Включить камеру</Button>}
      {phase === 'requesting' && <Button tone="quiet" onClick={stop}>Отменить запрос камеры</Button>}
      {(phase === 'preview' || phase === 'lost') && <Button onClick={align}>Совместить участок</Button>}
      {phase === 'align' && <><Button disabled={!registration} onClick={lock}>Закрепить на воде</Button><Button tone="quiet" disabled={!points.length} onClick={() => changePoints(points.slice(0, -1))}>Отменить точку</Button></>}
      {phase === 'tracking' && <Button tone="quiet" onClick={align}>Поправить привязку</Button>}
      {phase !== 'off' && phase !== 'requesting' && <Button tone="quiet" onClick={stop}>Выключить камеру</Button>}
    </div>
    <p className="photo-note">Приблизительная дистанция по плоскости воды. Не ходите во время замера: после смены места нужна новая привязка. Точность на iPhone в полевых условиях ещё не подтверждена.</p>
  </div>
}
