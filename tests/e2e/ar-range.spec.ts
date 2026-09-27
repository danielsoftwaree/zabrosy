import { expect, test } from '@playwright/test'

test('AR range needs a live rear-camera frame, explicit height, stable calibration and keeps a labelled capture', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => new MediaStream(),
    } })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
    for (const name of ['DeviceOrientationEvent', 'DeviceMotionEvent']) {
      Object.defineProperty(window, name, { configurable: true, value: { requestPermission: async () => 'granted' } })
    }
  })
  await page.goto('map')
  await expect(page.locator('.field-map__frame canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByText('Включите ориентацию в настройках')).toBeVisible()
  await page.getByRole('button', { name: 'Настройки наведения' }).click()
  const sheet = page.getByRole('dialog', { name: 'Настройки наведения' })
  await sheet.getByRole('button', { name: 'Включить ориентацию' }).click()
  await expect(sheet).toBeHidden()
  await page.evaluate(() => {
    const arWindow = window as Window & { __arBeta: number }
    arWindow.__arBeta = 90
    window.setInterval(() => {
      const event = new Event('deviceorientation')
      Object.defineProperties(event, { alpha: { value: 0 }, beta: { value: arWindow.__arBeta }, gamma: { value: 0 }, absolute: { value: false } })
      window.dispatchEvent(event)
    }, 110)
  })
  await page.getByRole('button', { name: 'Настройки наведения' }).click()
  await sheet.getByRole('textbox', { name: 'Высота объектива над водой, м' }).fill('1,5')
  await sheet.getByRole('textbox', { name: 'Допуск высоты ±, м' }).fill('')
  await expect(sheet.getByRole('button', { name: 'Подтвердить высоту над водой' })).toBeDisabled()
  await sheet.getByRole('textbox', { name: 'Допуск высоты ±, м' }).fill('0,1')
  await sheet.getByRole('button', { name: 'Подтвердить высоту над водой' }).click()
  await sheet.getByRole('button', { name: 'По видимому горизонту воды' }).click()
  await expect(sheet).toBeHidden()
  const captureCalibration = page.getByRole('button', { name: 'Зафиксировать калибровку' })
  await expect(captureCalibration).toBeEnabled()
  await captureCalibration.click()
  await expect(page.getByText('У горизонта ошибка слишком велика')).toBeVisible()
  await page.evaluate(() => { (window as Window & { __arBeta: number }).__arBeta = 80 })
  await expect(page.getByText('Оценка до точки под прицелом')).toBeVisible()
  await page.getByRole('button', { name: 'Зафиксировать оценку' }).click()
  await expect(page.getByText('Последняя оценка до точки под прицелом')).toBeVisible()
  await expect(page.locator('.camera-last-range')).toContainText('≈9 м')
  await expect(page.locator('.camera-last-range')).toContainText('Интервал')
  await expect(page.locator('.camera-last-range')).toContainText('калибровка по горизонту')
  await page.getByRole('button', { name: 'Снимок' }).click()
  await page.getByRole('button', { name: 'Камера' }).click()
  await expect(page.locator('.camera-last-range')).toContainText('≈9 м')
  await expect(page.getByText('Камера выключена')).toBeVisible()
})
