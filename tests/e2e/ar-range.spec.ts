import { expect, test, type Page } from '@playwright/test'

type Probe = {
  requests: { mode: string; requiredFeatures: string[]; overlay: boolean }[]
  ends: number
  cancels: number
  hit: { x: number; y: number; z: number } | null
  tracking: boolean
  emulated: boolean
  orientation: { x: number; y: number; z: number; w: number }
  reset: () => void
}

async function mockXr(page: Page, denyRequest = false) {
  await page.addInitScript((denied: boolean) => {
    const camera = { x: 0, y: 1.5, z: 0 }
    const local = new EventTarget()
    const viewer = new EventTarget()
    const probe: Probe = {
      requests: [], ends: 0, cancels: 0,
      hit: { x: 0, y: 0, z: -8 }, tracking: true, emulated: false,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      reset: () => local.dispatchEvent(new Event('reset')),
    }
    Object.defineProperty(window, '__xrProbe', { value: probe })

    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      if (type === 'webgl' || type === 'webgl2') return {
        FRAMEBUFFER: 0x8D40, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
        makeXRCompatible: async () => undefined,
        bindFramebuffer: () => undefined, viewport: () => undefined,
        clearColor: () => undefined, clear: () => undefined,
      } as WebGLRenderingContext
      return originalGetContext.call(this, type, ...options)
    } as typeof HTMLCanvasElement.prototype.getContext
    Object.defineProperty(window, 'XRWebGLLayer', { configurable: true, value: class {
      framebuffer = null
      framebufferWidth = 320
      framebufferHeight = 568
    } })
    Object.defineProperty(window, 'XRRay', { configurable: true, value: class {
      constructor(public origin: unknown, public direction: unknown) {}
    } })

    const projectionMatrix = new Float32Array(16)
    projectionMatrix[0] = projectionMatrix[5] = projectionMatrix[10] = projectionMatrix[15] = 1
    const session = Object.assign(new EventTarget(), {
      domOverlayState: { type: 'screen' },
      environmentBlendMode: 'alpha-blend',
      visibilityState: 'visible',
      renderState: { baseLayer: null as unknown },
      requestReferenceSpace: async (kind: string) => kind === 'local' ? local : viewer,
      requestHitTestSource: async () => ({ cancel: () => { probe.cancels += 1 } }),
      updateRenderState(state: { baseLayer: unknown }) { this.renderState.baseLayer = state.baseLayer },
      requestAnimationFrame(callback: (time: number, frame: unknown) => void) {
        return window.setTimeout(() => callback(performance.now(), {
          getViewerPose: () => probe.tracking ? {
            emulatedPosition: probe.emulated,
            transform: { position: camera, orientation: probe.orientation },
            views: [{ projectionMatrix, transform: { position: camera, orientation: probe.orientation } }],
          } : null,
          getHitTestResults: () => probe.hit ? [{ getPose: () => ({
            emulatedPosition: false,
            transform: { position: probe.hit, orientation: { x: 0, y: 0, z: 0, w: 1 } },
          }) }] : [],
        }), 100)
      },
      cancelAnimationFrame: (id: number) => window.clearTimeout(id),
      async end() { probe.ends += 1; this.dispatchEvent(new Event('end')) },
    })
    Object.defineProperty(navigator, 'xr', { configurable: true, value: {
      isSessionSupported: async (mode: string) => mode === 'immersive-ar',
      requestSession: async (mode: string, options: { requiredFeatures: string[]; domOverlay?: { root: Element } }) => {
        probe.requests.push({ mode, requiredFeatures: options.requiredFeatures, overlay: !!options.domOverlay?.root })
        if (denied) throw new DOMException('Permission denied', 'NotAllowedError')
        return session
      },
    } })
  }, denyRequest)
}

async function counts(page: Page) {
  return page.evaluate(() => {
    const { requests, ends, cancels } = (window as Window & { __xrProbe: Probe }).__xrProbe
    return { requests, ends, cancels }
  })
}

test('unsupported spatial tracking offers imagery without numeric camera setup', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: async () => false,
  } }))
  await page.goto('map')
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await expect(page.getByText('Этот браузер не передаёт расстояние до объектов.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Высота объектива|Допуск высоты|Известная горизонтальная дистанция/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Выбрать на снимке' }).click()
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
})

test('refused XR permission explains the failure and keeps ordinary camera and map actions', async ({ page }) => {
  await mockXr(page, true)
  await page.goto('map')
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Измерить камерой' }).click()
  await expect(page.getByText('Браузер не открыл AR. Проверьте поддержку и разрешение камеры.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать на снимке' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить расстояние' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('marker:last-xr-range'))).toBeNull()
})

test('tracked hit becomes savable after stable frames and closes XR resources', async ({ page }) => {
  await mockXr(page)
  await page.goto('map')
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Измерить камерой' }).click()
  await expect.poll(async () => (await counts(page)).requests.length).toBe(1)
  expect((await counts(page)).requests[0]).toEqual({
    mode: 'immersive-ar', requiredFeatures: expect.arrayContaining(['hit-test', 'dom-overlay', 'local']), overlay: true,
  })
  const save = page.getByRole('button', { name: 'Сохранить расстояние' })
  await expect(save).toBeEnabled()
  await page.evaluate(() => { (window as Window & { __xrProbe: Probe }).__xrProbe.tracking = false })
  await expect(save).toHaveCount(0)
  await page.evaluate(() => { (window as Window & { __xrProbe: Probe }).__xrProbe.tracking = true })
  await expect(save).toBeEnabled()
  await save.click()
  const capture = await page.evaluate(() => JSON.parse(sessionStorage.getItem('marker:last-xr-range') ?? 'null')?.capture)
  expect(capture?.source).toBe('surface')
  expect(capture.distanceM).toBeCloseTo(8)
  expect(capture.measuredAt).toBeGreaterThan(0)
  await page.locator('.camera-xr').getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByText('Последний сохранённый замер')).toBeVisible()
  await page.getByRole('button', { name: 'Снимок' }).click()
  await expect.poll(async () => (await counts(page)).ends).toBe(1)
  expect((await counts(page)).cancels).toBeGreaterThanOrEqual(1)
})

test('shore confirmation enables water-plane aim; tracking loss and reset disable capture', async ({ page }) => {
  await mockXr(page)
  await page.goto('map')
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Измерить камерой' }).click()
  await expect(page.getByRole('button', { name: 'Сохранить расстояние' })).toBeEnabled()
  await page.evaluate(() => { (window as Window & { __xrProbe: Probe }).__xrProbe.hit = { x: 0, y: 0, z: -2 } })
  await page.getByRole('button', { name: 'Уточнить по берегу' }).click()
  const confirm = page.getByRole('button', { name: 'Это граница воды' })
  await expect(confirm).toBeEnabled()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('button', { name: 'Сохранить расстояние' })).toBeEnabled()
  await page.getByRole('button', { name: 'Уточнить по берегу' }).click()
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await page.evaluate(() => {
    const xr = (window as Window & { __xrProbe: Probe }).__xrProbe
    xr.hit = null
    xr.orientation = { x: -0.149438, y: 0, z: 0, w: 0.988771 }
  })
  const save = page.getByRole('button', { name: 'Сохранить расстояние' })
  await expect(save).toBeEnabled()
  await save.click()
  const capture = await page.evaluate(() => JSON.parse(sessionStorage.getItem('marker:last-xr-range') ?? 'null')?.capture)
  expect(capture?.source).toBe('water-plane')
  expect(capture.distanceM).toBeGreaterThan(0)
  await page.evaluate(() => (window as Window & { __xrProbe: Probe }).__xrProbe.reset())
  await expect(save).toHaveCount(0)
  await page.evaluate(() => { (window as Window & { __xrProbe: Probe }).__xrProbe.tracking = false })
  await expect(save).toHaveCount(0)
  await page.evaluate(() => { (window as Window & { __xrProbe: Probe }).__xrProbe.tracking = true })
  await expect(save).toHaveCount(0)
})
