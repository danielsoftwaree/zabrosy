import { useCallback, useEffect, useRef, useState } from 'react'
import { horizontalDistance, screenCentreRay, shoreHitEligible, stableXrTarget, viewerDirection, waterPlaneTarget } from './xr-range'
import type { XrPoint, XrRangeCapture, XrRangeResult, XrSample } from './xr-range'

type Phase = 'off' | 'requesting' | 'aiming' | 'shore'
type Support = 'checking' | 'supported' | 'unsupported'

export function useXrRange(active: boolean) {
  const [support, setSupport] = useState<Support>('checking')
  const [phase, setPhase] = useState<Phase>('off')
  const [result, setResult] = useState<XrRangeResult | null>(null)
  const [shoreReady, setShoreReady] = useState(false)
  const [issue, setIssue] = useState<string | null>(null)
  const activeRef = useRef(active)
  const mounted = useRef(false)
  const generation = useRef(0)
  const sessionRef = useRef<XRSession | null>(null)
  const hitSourceRef = useRef<XRHitTestSource | null>(null)
  const frameRef = useRef<number | null>(null)
  const listenersRef = useRef<(() => void) | null>(null)
  const phaseRef = useRef<Phase>('off')
  const resultRef = useRef<XrRangeResult | null>(null)
  const directSamples = useRef<XrSample[]>([])
  const planeSamples = useRef<XrSample[]>([])
  const waterLevelRef = useRef<number | null>(null)
  const lastUiAt = useRef(0)
  const lastFrameAt = useRef(0)

  const clearReading = useCallback(() => {
    directSamples.current = []
    planeSamples.current = []
    resultRef.current = null
    if (mounted.current) { setResult(null); setShoreReady(false) }
  }, [])

  const shutdown = useCallback((message: string | null = null, endSession = true) => {
    generation.current++
    const session = sessionRef.current
    sessionRef.current = null
    if (session && frameRef.current !== null) { try { session.cancelAnimationFrame(frameRef.current) } catch { /* Session may already have ended. */ } }
    frameRef.current = null
    try { hitSourceRef.current?.cancel() } catch { /* Inactive hit-test sources cannot be cancelled again. */ }
    hitSourceRef.current = null
    listenersRef.current?.()
    listenersRef.current = null
    if (session && endSession) void session.end().catch(() => {})
    waterLevelRef.current = null
    phaseRef.current = 'off'
    clearReading()
    if (mounted.current) { setPhase('off'); setIssue(message) }
  }, [clearReading])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const xr = navigator.xr
    if (!xr?.isSessionSupported) { void Promise.resolve().then(() => { if (!cancelled) setSupport('unsupported') }) }
    else void xr.isSessionSupported('immersive-ar').then(
      available => { if (!cancelled) setSupport(available ? 'supported' : 'unsupported') },
      () => { if (!cancelled) setSupport('unsupported') },
    )
    return () => { cancelled = true; mounted.current = false; shutdown() }
  }, [shutdown])

  useEffect(() => { activeRef.current = active; if (!active) shutdown() }, [active, shutdown])

  const start = async (root: HTMLElement) => {
    if (!activeRef.current || phaseRef.current !== 'off') return
    if (!root.isConnected || !navigator.xr?.requestSession || typeof XRWebGLLayer === 'undefined') {
      setIssue('Этот браузер не поддерживает измерение камерой. Выберите точку на снимке.')
      return
    }
    const run = ++generation.current
    phaseRef.current = 'requesting'
    setPhase('requesting')
    setIssue(null)
    clearReading()
    let session: XRSession
    try {
      // Keep this call in the click gesture: immersive sessions may require user activation.
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay', 'local'], domOverlay: { root },
      })
    } catch {
      if (run === generation.current && mounted.current) shutdown('Браузер не открыл AR. Проверьте поддержку и разрешение камеры.')
      return
    }
    if (run !== generation.current || !mounted.current || !activeRef.current || document.hidden) {
      void session.end().catch(() => {})
      return
    }
    sessionRef.current = session
    try {
      if (!session.domOverlayState || session.environmentBlendMode === 'opaque' || !session.requestHitTestSource) {
        throw new Error('Браузер не предоставил данные для измерения. Выберите точку на снимке.')
      }
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl', { alpha: true, xrCompatible: true })
      if (!gl) throw new Error('Не удалось открыть изображение для измерения.')
      const onLost = (event: Event) => { event.preventDefault(); shutdown('Изображение для измерения прервано. Откройте камеру снова.') }
      canvas.addEventListener('webglcontextlost', onLost)
      const onEnd = () => shutdown('Сеанс AR завершён.', false)
      const onVisibility = () => { if (document.hidden || session.visibilityState !== 'visible') shutdown('Сеанс AR прерван.') }
      const onOrientation = () => {
        waterLevelRef.current = null
        phaseRef.current = 'aiming'
        clearReading()
        setPhase('aiming')
        setIssue('Положение изменилось. При необходимости подтвердите уровень воды снова.')
      }
      session.addEventListener('end', onEnd)
      session.addEventListener('visibilitychange', onVisibility)
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('orientationchange', onOrientation)
      listenersRef.current = () => {
        canvas.removeEventListener('webglcontextlost', onLost)
        session.removeEventListener('end', onEnd)
        session.removeEventListener('visibilitychange', onVisibility)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('orientationchange', onOrientation)
      }
      await gl.makeXRCompatible()
      if (run !== generation.current) return
      const layer = new XRWebGLLayer(session, gl, { alpha: true })
      await session.updateRenderState({ baseLayer: layer })
      if (run !== generation.current) return
      const local = await session.requestReferenceSpace('local')
      const viewer = await session.requestReferenceSpace('viewer')
      if (run !== generation.current) return
      const requestHitTestSource = session.requestHitTestSource
      if (!requestHitTestSource) throw new Error('Камера не определяет поверхности. Выберите точку на снимке.')
      const onReset = () => {
        waterLevelRef.current = null
        phaseRef.current = 'aiming'
        clearReading()
        setPhase('aiming')
        setIssue('Отслеживание изменилось. При необходимости подтвердите уровень воды снова.')
      }
      local.addEventListener('reset', onReset)
      const priorCleanup = listenersRef.current
      listenersRef.current = () => { local.removeEventListener('reset', onReset); priorCleanup?.() }
      phaseRef.current = 'aiming'
      setPhase('aiming')

      let requestedRay: XrPoint | null = null
      let sourceRay: XrPoint | null = null
      let sourcePending = false
      const rayChanged = (a: XrPoint | null, b: XrPoint) => !a || Math.hypot(a.x - b.x, a.y - b.y) > 0.001
      lastFrameAt.current = performance.now()
      const watchdog = window.setInterval(() => {
        if (run !== generation.current || performance.now() - lastFrameAt.current <= 500) return
        waterLevelRef.current = null
        if (directSamples.current.length || planeSamples.current.length || resultRef.current) clearReading()
        setIssue('AR потерял кадры. Уровень воды сброшен; наведите прицел снова.')
      }, 250)
      const cleanupWithReset = listenersRef.current
      listenersRef.current = () => { window.clearInterval(watchdog); cleanupWithReset?.() }

      const onFrame: XRFrameRequestCallback = (_time, frame) => {
        if (run !== generation.current || !sessionRef.current) return
        try {
        const now = performance.now()
        if (now - lastFrameAt.current > 500) {
          waterLevelRef.current = null
          clearReading()
          setIssue('AR потерял кадры. Уровень воды сброшен; наведите прицел снова.')
        }
        lastFrameAt.current = now
        frameRef.current = session.requestAnimationFrame(onFrame)
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer)
        gl.viewport(0, 0, layer.framebufferWidth, layer.framebufferHeight)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        const pose = frame.getViewerPose(local)
        if (!pose || pose.emulatedPosition) {
          waterLevelRef.current = null
          if (directSamples.current.length || planeSamples.current.length || resultRef.current) clearReading()
          if (now - lastUiAt.current >= 100) { setIssue('Нет надёжного отслеживания положения.'); lastUiAt.current = now }
          return
        }
        const view = pose.views[0]
        if (pose.views.length !== 1 || !view) { shutdown('Это устройство не поддерживает данный режим измерения.'); return }
        const camera: XrPoint = view.transform.position
        const viewerPosition: XrPoint = pose.transform.position
        const orientation = view.transform.orientation
        const viewerOrientation = pose.transform.orientation
        const orientationDot = Math.abs(orientation.x * viewerOrientation.x + orientation.y * viewerOrientation.y
          + orientation.z * viewerOrientation.z + orientation.w * viewerOrientation.w)
        if (Math.hypot(camera.x - viewerPosition.x, camera.y - viewerPosition.y, camera.z - viewerPosition.z) > 0.03
          || orientationDot < 0.999) { shutdown('Не удалось совместить прицел с изображением камеры.'); return }
        const centreRay = screenCentreRay(view.projectionMatrix)
        const direction = centreRay && viewerDirection(orientation, centreRay)
        if (!direction || !centreRay) { shutdown('Не удалось определить направление прицела.'); return }
        requestedRay = centreRay
        if (rayChanged(sourceRay, centreRay) && !sourcePending) {
          try { hitSourceRef.current?.cancel() } catch { /* The runtime may have invalidated it. */ }
          hitSourceRef.current = null
          sourceRay = null
          clearReading()
          sourcePending = true
          const hitPromise = requestHitTestSource.call(session, { space: viewer, offsetRay: new XRRay({}, { ...centreRay, w: 0 }) })
          if (!hitPromise) { shutdown('Камера не определяет поверхности. Выберите точку на снимке.'); return }
          void hitPromise.then(source => {
            sourcePending = false
            if (run !== generation.current || rayChanged(requestedRay, centreRay)) {
              try { source.cancel() } catch { /* Session already ended. */ }
              return
            }
            hitSourceRef.current = source
            sourceRay = centreRay
          }, () => { sourcePending = false; if (run === generation.current) shutdown('Камера не определяет поверхность под прицелом.') })
        }
        const hit = hitSourceRef.current && !rayChanged(sourceRay, centreRay)
          ? frame.getHitTestResults(hitSourceRef.current)[0]?.getPose(local) : null
        if (hit && !hit.emulatedPosition) {
          const target: XrPoint = hit.transform.position
          const distanceM = horizontalDistance(camera, target)
          if (Number.isFinite(distanceM) && distanceM > 0.2 && distanceM <= 200) {
            directSamples.current = [...directSamples.current.filter(sample => now - sample.at <= 900), { at: now, camera, direction, target }]
          } else directSamples.current = []
        } else directSamples.current = []

        const waterLevelY = waterLevelRef.current
        if (waterLevelY !== null) {
          const target = waterPlaneTarget(camera, direction, waterLevelY)
          planeSamples.current = target
            ? [...planeSamples.current.filter(sample => now - sample.at <= 900), { at: now, camera, direction, target }]
            : []
        }
        const direct = stableXrTarget(directSamples.current, now)
        const plane = stableXrTarget(planeSamples.current, now)
        const ready = phaseRef.current === 'shore' && !!direct && shoreHitEligible(direct.camera, direct.target)
        const next: XrRangeResult | null = phaseRef.current !== 'aiming' ? null
          : waterLevelY !== null && plane ? { distanceM: horizontalDistance(plane.camera, plane.target), source: 'water-plane' }
            : waterLevelY === null && direct ? { distanceM: horizontalDistance(direct.camera, direct.target), source: 'surface' } : null
        resultRef.current = next
        if (now - lastUiAt.current >= 100) {
          lastUiAt.current = now
          setResult(next)
          setShoreReady(ready)
          setIssue(null)
        }
        } catch {
          shutdown('Отслеживание AR прервалось. Запустите его снова.')
        }
      }
      frameRef.current = session.requestAnimationFrame(onFrame)
    } catch (error) {
      if (run === generation.current) shutdown(error instanceof Error ? error.message : 'AR не удалось запустить.')
    }
  }

  const stop = () => shutdown()
  const beginShore = () => {
    if (phaseRef.current !== 'aiming' || !sessionRef.current) return
    waterLevelRef.current = null
    phaseRef.current = 'shore'
    clearReading()
    setPhase('shore')
  }
  const confirmShore = () => {
    if (phaseRef.current !== 'shore' || !sessionRef.current || document.hidden) return
    const stable = stableXrTarget(directSamples.current, performance.now())
    if (!stable || !shoreHitEligible(stable.camera, stable.target)) return
    waterLevelRef.current = stable.target.y
    phaseRef.current = 'aiming'
    clearReading()
    setPhase('aiming')
  }
  const cancelShore = () => {
    if (phaseRef.current !== 'shore') return
    phaseRef.current = 'aiming'
    clearReading()
    setPhase('aiming')
  }
  const capture = (): XrRangeCapture | null => {
    if (phaseRef.current !== 'aiming' || !sessionRef.current || document.hidden || sessionRef.current.visibilityState !== 'visible') return null
    const now = performance.now()
    const waterLevelY = waterLevelRef.current
    const stable = stableXrTarget(waterLevelY === null ? directSamples.current : planeSamples.current, now)
    if (!stable) return null
    const distanceM = horizontalDistance(stable.camera, stable.target)
    if (!Number.isFinite(distanceM) || distanceM <= 0.2 || !resultRef.current) return null
    return waterLevelY === null
      ? { distanceM, source: 'surface', measuredAt: Date.now() }
      : { distanceM, source: 'water-plane', measuredAt: Date.now(), waterLevelY, heightM: stable.camera.y - waterLevelY }
  }

  return { support, phase, result, shoreReady, issue, start, stop, beginShore, confirmShore, cancelShore, capture }
}
