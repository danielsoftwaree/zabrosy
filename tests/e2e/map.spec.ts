import { expect, test, type Page } from '@playwright/test'

async function stubOrtho(page: Page) {
  await page.route('https://mapy.geoportal.gov.pl/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#bfd3ba"/></svg>',
  }))
}

test('manual coordinates save station and target when imagery is unavailable', async ({ page }) => {
  await page.route('https://mapy.geoportal.gov.pl/**', route => route.abort())
  await page.goto('./')
  await page.getByRole('button', { name: /Заброс #1/ }).click()
  await page.getByRole('button', { name: 'Новая сессия' }).click()
  await expect(page.getByRole('dialog', { name: 'Сессия' })).toBeHidden()
  await page.goto('map')
  await expect(page.locator('.field-map__fallback')).toContainText('Снимок недоступен')
  await page.getByRole('button', { name: 'Точка и настройки' }).click()
  const coordinates = page.locator('.map-footer[aria-label="Координаты и навигация"]')
  await coordinates.getByRole('textbox', { name: 'Широта' }).fill('53,3866857')
  await coordinates.getByRole('textbox', { name: 'Долгота' }).fill('14,6190476')
  await coordinates.getByRole('button', { name: 'Выбрать точку' }).click()
  await page.locator('.map-footer[aria-label="Выбранная точка"]').getByRole('button', { name: 'Это станция' }).click()
  await page.getByRole('button', { name: 'Точка и настройки' }).click()
  await coordinates.getByRole('textbox', { name: 'Долгота' }).fill('14,6195')
  await coordinates.getByRole('button', { name: 'Выбрать точку' }).click()
  await page.locator('.map-footer[aria-label="Выбранная точка"]').getByRole('button', { name: 'Сохранить цель' }).click()
  await expect(page.locator('.map-panel__target')).toContainText('≈30 м от станции')
  await page.reload()
  await expect(page.locator('.map-panel__target')).toContainText('≈30 м от станции')
})

test('a selected map point survives creating the first session', async ({ page }) => {
  await stubOrtho(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'Снимок' }).click()
  const map = page.getByRole('button', { name: /Снимок участка/ })
  await expect(page.locator('.field-map__fallback')).toHaveCount(0)
  const box = await map.boundingBox()
  if (!box) throw new Error('Map is not visible')
  await map.click({ position: { x: box.width * .25, y: box.height * .5 } })
  const point = page.locator('.map-footer[aria-label="Выбранная точка"]')
  await expect(point.getByRole('button', { name: 'Создать сессию' })).toBeVisible()
  await expect(point.getByRole('button', { name: 'Сохранить цель' })).toHaveCount(0)
  const coordinate = await point.locator('.map-footer__position').innerText()
  await point.getByRole('button', { name: 'Создать сессию' }).click()
  await expect(point.locator('.map-footer__position')).toHaveText(coordinate)
  await point.getByRole('button', { name: 'Это станция' }).click()
  await expect(page.locator('.field-map__marker--station')).toBeVisible()
})

test('camera refusal keeps a saved target available for manual guidance', async ({ page }) => {
  await stubOrtho(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError') },
    } })
    for (const name of ['DeviceOrientationEvent', 'DeviceMotionEvent']) {
      Object.defineProperty(window, name, { configurable: true, value: { requestPermission: async () => 'denied' } })
    }
  })
  await page.goto('./')
  await page.getByRole('button', { name: /Заброс #1/ }).click()
  await page.getByRole('button', { name: 'Новая сессия' }).click()
  await expect(page.getByRole('dialog', { name: 'Сессия' })).toBeHidden()
  await page.goto('map')
  const map = page.getByRole('button', { name: /Снимок участка/ })
  await expect(page.locator('.field-map__fallback')).toHaveCount(0)
  const box = await map.boundingBox()
  if (!box) throw new Error('Map is not visible')
  await map.click({ position: { x: box.width * .25, y: box.height * .5 } })
  await page.getByRole('button', { name: 'Это станция' }).click()
  await map.click({ position: { x: box.width * .7, y: box.height * .5 } })
  await page.getByRole('button', { name: 'Это ориентир' }).click()
  await map.click({ position: { x: box.width * .8, y: box.height * .4 } })
  await page.getByRole('button', { name: 'Сохранить цель' }).click()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.locator('.camera-stage').getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByText('Камера недоступна. Можно наводиться вручную.')).toBeVisible()
  await page.locator('.camera-stage').getByRole('button', { name: 'Настройки наведения' }).click()
  const settings = page.getByRole('dialog', { name: 'Настройки наведения' })
  const bearing = settings.getByRole('slider', { name: /Поворот от ориентира вручную/ })
  await expect(bearing).toBeVisible()
  await bearing.focus()
  await bearing.press('ArrowRight')
  await expect(bearing).toHaveValue('1')
  await settings.getByRole('button', { name: 'Включить ориентацию' }).click()
  await expect(settings.getByText('Датчик недоступен · ручное наведение')).toBeVisible()
  await settings.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.locator('.camera-stage').getByRole('button', { name: 'Включить камеру' })).toBeVisible()
  await expect(page.locator('.camera-stage__target')).toContainText(/^Цель \d+° (левее|правее) центра$/)
  await expect(page.getByRole('button', { name: 'Снимок' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('camera tracks stop on view switch, route navigation, and tab hiding', async ({ page }) => {
  await stubOrtho(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const probe = { requests: 0, stops: 0 }
    Object.defineProperty(window, '__cameraProbe', { configurable: true, value: probe })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        probe.requests += 1
        const stream = new MediaStream()
        Object.defineProperty(stream, 'getTracks', { value: () => [{ stop: () => { probe.stops += 1 } }] })
        return stream
      },
    } })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) })
  })
  const counts = () => page.evaluate(() => (window as Window & { __cameraProbe: { requests: number; stops: number } }).__cameraProbe)

  await page.goto('map')
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  expect(await counts()).toEqual({ requests: 1, stops: 0 })

  await page.getByRole('button', { name: 'Дно' }).click()
  await expect.poll(async () => (await counts()).stops).toBe(1)
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  await page.getByRole('link', { name: 'Журнал' }).click()
  await expect.poll(async () => (await counts()).stops).toBe(2)

  await page.getByRole('button', { name: 'Меню и настройки' }).click()
  await page.getByRole('link', { name: /Карта участка/ }).click()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible()
  expect(await counts()).toEqual({ requests: 3, stops: 3 })
  expect(errors).toEqual([])
})

test('home field views keep the active cast and release camera on every switch', async ({ page }) => {
  await stubOrtho(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const probe = { requests: 0, stops: 0 }
    Object.defineProperty(window, '__cameraProbe', { configurable: true, value: probe })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        probe.requests += 1
        const stream = new MediaStream()
        Object.defineProperty(stream, 'getTracks', { value: () => [{ stop: () => { probe.stops += 1 } }] })
        return stream
      },
    } })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) })
  })
  const counts = () => page.evaluate(() => (window as Window & { __cameraProbe: { requests: number; stops: number } }).__cameraProbe)

  await page.goto('./')
  await page.getByRole('button', { name: 'Начать промер' }).click()
  await expect(page.getByRole('button', { name: /Коснулся воды/ })).toBeVisible()

  await page.getByRole('button', { name: 'Снимок' }).click()
  await expect(page.locator('.field-map__frame')).toBeVisible()
  const surface = await page.locator('.survey-surface').boundingBox()
  const frame = await page.locator('.field-map__frame').boundingBox()
  if (!surface || !frame) throw new Error('Field map surface is missing')
  expect(Math.abs(frame.width - surface.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(frame.height - surface.height)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Точка и настройки' }).click()
  await expect(page.getByRole('textbox', { name: 'Широта' })).toBeVisible()
  await page.locator('.map-footer').getByRole('button', { name: 'К промеру' }).click()

  await page.getByRole('button', { name: '3D' }).click()
  await expect(page.locator('.map-bottom')).toBeVisible()
  await expect(page.locator('.map-bottom select')).toHaveCount(0)
  await page.getByRole('button', { name: 'Настройки рельефа' }).click()
  const reliefSettings = page.getByRole('dialog', { name: 'Настройки рельефа' })
  await expect(reliefSettings.getByRole('radio', { name: 'Мои промеры этой рыбалки' })).toBeChecked()
  await reliefSettings.getByRole('radio', { name: '3D схема' }).check()
  await reliefSettings.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.locator('.map-bottom__summary')).toContainText('3D схема')
  await page.getByRole('button', { name: 'AR' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  expect(await counts()).toEqual({ requests: 1, stops: 0 })

  await page.getByRole('button', { name: 'Сектор' }).click()
  await expect(page.getByRole('button', { name: /Коснулся воды/ })).toBeVisible()
  await expect.poll(async () => (await counts()).stops).toBe(1)

  await page.getByRole('button', { name: 'AR' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('button', { name: 'Выключить камеру' })).toBeVisible()
  await page.getByRole('button', { name: 'Снимок' }).click()
  await expect.poll(async () => (await counts()).stops).toBe(2)
  expect(await counts()).toEqual({ requests: 2, stops: 2 })
  expect(errors).toEqual([])
})

test('desktop opens the current route once inside a mobile frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('map')
  const iframe = page.locator('iframe[title="Маркер — мобильное приложение"]')
  await expect(iframe).toBeVisible()
  await expect(iframe).toHaveAttribute('src', /\/map\/?\?markerFrame=1$/)
  await expect(page.getByRole('link', { name: 'Открыть отдельно' })).toHaveAttribute('href', /\/map\/?\?markerFrame=1$/)
  await expect(page.locator('body > .app-shell')).toHaveCount(0)
  const app = page.frameLocator('iframe[title="Маркер — мобильное приложение"]')
  await expect(app.getByRole('link', { name: 'Промер' })).toBeVisible()
  await app.getByRole('link', { name: 'Промер' }).click()
  await expect(app.getByRole('button', { name: 'Начать промер' })).toBeVisible()
  await expect(page.locator('iframe[title="Маркер — мобильное приложение"]')).toHaveCount(1)
})
