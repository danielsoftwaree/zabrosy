import { expect, test, type Page } from '@playwright/test'
import { preparePhotoArea } from './photo-flow'

async function prepareMockCamera(page: Page, fallback = false) {
  await page.route('https://mapy.geoportal.gov.pl/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#bfd3ba"/></svg>',
  }))
  await page.addInitScript(({ fallback }) => {
    if (fallback) Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: undefined })
    const probe = { requests: 0, stops: 0, blank: false }
    Object.defineProperty(window, '__liveProbe', { configurable: true, value: probe })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        probe.requests++
        const canvas = document.createElement('canvas')
        canvas.width = 640; canvas.height = 480
        const context = canvas.getContext('2d')!
        const pixels = context.createImageData(640, 480)
        let seed = 73
        for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) | 0
          const i = (y * 640 + x) * 4
          const value = (seed >>> 24) & 255
          pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value; pixels.data[i + 3] = 255
        }
        const paint = () => probe.blank ? (context.fillStyle = '#fff', context.fillRect(0, 0, 640, 480)) : context.putImageData(pixels, 0, 0)
        paint()
        const timer = window.setInterval(paint, 80)
        const stream = canvas.captureStream(15)
        const track = stream.getVideoTracks()[0]
        const originalStop = track.stop.bind(track)
        track.stop = () => { probe.stops++; clearInterval(timer); originalStop() }
        return stream
      },
    } })
  }, { fallback })

  await page.goto('map')
  await expect(page.locator('.field-map__frame')).toHaveAttribute('data-imagery-status', 'ready')
  await preparePhotoArea(page, 'live')
}

async function touchLiveCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas.live-camera-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Live camera canvas is missing')
  await canvas.click({ position: { x: box.width * x, y: box.height * y } })
}

async function alignLiveCamera(page: Page) {
  const live = page.locator('.live-camera')
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(live).toHaveAttribute('data-phase', 'preview')
  await page.getByRole('button', { name: 'Совместить участок' }).click()
  await expect(live).toHaveAttribute('data-phase', 'align')
  for (const [x, y] of [[.2, .7], [.8, .7], [.8, .25], [.2, .25]]) await touchLiveCanvas(page, x, y)
  await expect(page.getByRole('button', { name: 'Закрепить на воде' })).toBeEnabled()
}

test('live map registration measures only while the camera alignment is tracked', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepareMockCamera(page)
  const live = page.locator('.live-camera')
  await expect(live).toHaveAttribute('data-phase', 'off')
  await alignLiveCamera(page)
  await page.getByRole('button', { name: 'Закрепить на воде' }).click()
  await expect(live).toHaveAttribute('data-phase', 'tracking')
  await touchLiveCanvas(page, .5, .5)
  await expect(live.locator('.photo-result')).toContainText(/≈ \d+ м/)
  await page.evaluate(() => { (window as Window & { __liveProbe: { blank: boolean } }).__liveProbe.blank = true })
  await expect(live).toHaveAttribute('data-phase', 'lost')
  await expect(live.locator('.photo-result')).toHaveCount(0)
  await expect(live).toContainText('Замер приостановлен')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(live).toHaveAttribute('data-phase', 'off')
  expect(await page.evaluate(() => (window as Window & { __liveProbe: { requests: number; stops: number } }).__liveProbe)).toMatchObject({ requests: 1, stops: 1 })
  expect(errors).toEqual([])
})

test('manual point correction and target transfer work, and stopped video loses the registration', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepareMockCamera(page, true)
  const live = page.locator('.live-camera')
  await alignLiveCamera(page)
  const canvas = page.locator('canvas.live-camera-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Live camera canvas is missing')
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .7)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .24, box.y + box.height * .68, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Закрепить на воде' })).toBeEnabled()
  await page.getByRole('button', { name: 'Закрепить на воде' }).click()
  await expect(live).toHaveAttribute('data-phase', 'tracking')
  await touchLiveCanvas(page, .5, .5)
  await expect(live.locator('.photo-result')).toContainText(/≈ \d+ м/)
  await page.getByRole('button', { name: 'Показать цель на карте' }).click()
  await expect(page.locator('.map-footer[aria-label="Выбранная точка"]')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await alignLiveCamera(page)
  await page.getByRole('button', { name: 'Закрепить на воде' }).click()
  await expect(live).toHaveAttribute('data-phase', 'tracking')
  await touchLiveCanvas(page, .5, .5)
  await expect(live.locator('.photo-result')).toContainText(/≈ \d+ м/)
  await page.locator('.live-camera video').evaluate(video => video.pause())
  await expect(live).toHaveAttribute('data-phase', 'lost', { timeout: 2500 })
  await expect(live.locator('.photo-result')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a changed camera image during manual alignment cannot be locked as a measurement', async ({ page }) => {
  await prepareMockCamera(page)
  const live = page.locator('.live-camera')
  await alignLiveCamera(page)
  await page.evaluate(() => { (window as Window & { __liveProbe: { blank: boolean } }).__liveProbe.blank = true })
  await expect.poll(() => page.locator('.live-camera video').evaluate(video => {
    const sample = document.createElement('canvas')
    sample.width = 4; sample.height = 4
    const context = sample.getContext('2d')!
    context.drawImage(video, 0, 0, 4, 4)
    return context.getImageData(0, 0, 4, 4).data.every(value => value === 255)
  })).toBe(true)
  await page.getByRole('button', { name: 'Закрепить на воде' }).click()
  await expect(live).toHaveAttribute('data-phase', 'lost')
  await expect(live.locator('.photo-result')).toHaveCount(0)
  await expect(live.getByRole('alert')).toContainText('Камера сместилась во время совмещения')
})
