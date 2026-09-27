import { expect, test } from '@playwright/test'
import { preparePhotoArea, uploadSamplePhoto } from './photo-flow'

const ortho = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#bfd3ba"/></svg>'

test.beforeEach(async ({ page }) => {
  await page.route('https://mapy.geoportal.gov.pl/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ortho }))
})

test('two map points show a distance and the far bank can be replaced', async ({ page }) => {
  await page.goto('map')
  await expect(page.locator('.field-map__frame')).toHaveAttribute('data-imagery-status', 'ready')
  const map = page.getByRole('button', { name: /Снимок участка/ })
  const touch = async (x: number, y: number) => {
    const box = await map.boundingBox()
    if (!box) throw new Error('Map is not visible')
    await map.click({ position: { x: box.width * x, y: box.height * y } })
  }
  await page.getByRole('button', { name: 'Измерить между точками' }).click()
  await touch(.3, .55)
  await expect(page.locator('.map-hint')).toContainText('Теперь отметьте второй берег')
  await touch(.7, .35)
  const first = await page.locator('.map-footer__distance').innerText()
  expect(first).toMatch(/≈ \d+ м/)
  await page.getByRole('button', { name: 'Убрать второй берег' }).click()
  await expect(page.locator('.map-footer__distance')).toHaveCount(0)
  await touch(.65, .4)
  await expect(page.locator('.map-footer__distance')).toBeVisible()
  await expect(page.locator('.map-footer__distance')).not.toHaveText(first)
})

test('a prepared photo maps a selected water point and rejects the outside area', async ({ page }) => {
  await page.goto('map')
  await expect(page.locator('.field-map__frame')).toHaveAttribute('data-imagery-status', 'ready')
  await preparePhotoArea(page)
  await uploadSamplePhoto(page)
  const photo = page.locator('canvas.photo-canvas')
  const fitted = await photo.boundingBox()
  await page.getByRole('button', { name: 'Увеличить фото 2×' }).click()
  const enlarged = await photo.boundingBox()
  expect(enlarged!.width).toBeGreaterThan(fitted!.width * 1.8)
  await page.getByRole('button', { name: 'Уместить фото' }).click()
  const beforeDrag = await photo.boundingBox()
  await page.mouse.move(beforeDrag!.x + 80, beforeDrag!.y + 80)
  await page.mouse.down()
  await page.mouse.move(beforeDrag!.x + 120, beforeDrag!.y + 105, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByText('Совместите точку 1 из 4')).toBeVisible()
  const click = async (x: number, y: number) => {
    const box = await photo.boundingBox()
    if (!box) throw new Error('Photo is not visible')
    await photo.click({ position: { x: box.width * x, y: box.height * y } })
  }
  for (const [x, y] of [[.2, .7], [.8, .7], [.8, .25], [.2, .25]]) await click(x, y)
  await expect(page.getByText('Выберите место на воде')).toBeVisible()
  await click(.5, .5)
  await expect(page.locator('.photo-result')).toContainText(/≈ \d+ м/)
  await click(.05, .05)
  await expect(page.getByRole('alert')).toContainText('внутри четырёх отмеченных точек')
  await expect(page.locator('.photo-result')).toHaveCount(0)
  await click(.5, .5)
  await page.getByRole('button', { name: 'Показать цель на карте' }).click()
  await expect(page.locator('.map-footer[aria-label="Выбранная точка"]')).toBeVisible()
  await page.getByRole('button', { name: 'Камера' }).click()
  await expect(page.locator('canvas.photo-canvas')).toBeVisible()
  await expect(page.locator('.photo-result')).toContainText(/≈ \d+ м/)
  await page.getByRole('button', { name: 'Снимок' }).click()
  await page.getByRole('button', { name: 'Измерить между точками' }).click()
  await page.getByRole('button', { name: 'Камера' }).click()
  await page.getByRole('button', { name: 'Фото', exact: true }).click()
  await expect(page.getByText('От снимка к фото')).toBeVisible()
  await expect(page.locator('canvas.photo-canvas')).toHaveCount(0)
})

test('a new photograph clears old marks and refused camera access keeps file entry', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError') },
  } }))
  await page.goto('map')
  await expect(page.locator('.field-map__frame')).toHaveAttribute('data-imagery-status', 'ready')
  await preparePhotoArea(page)
  await page.getByRole('button', { name: 'Включить камеру' }).click()
  await expect(page.getByRole('alert')).toContainText('Камера недоступна')
  await expect(page.locator('input[type="file"][accept="image/*"]')).toBeAttached()
  await uploadSamplePhoto(page)
  const photo = page.locator('canvas.photo-canvas')
  await photo.click({ position: { x: 90, y: 120 } })
  await expect(page.getByText('Совместите точку 2 из 4')).toBeVisible()
  await page.getByRole('button', { name: 'Новый кадр' }).click()
  await expect(page.getByText('Снимите оба берега')).toBeVisible()
  await expect(page.locator('.photo-result')).toHaveCount(0)
  await uploadSamplePhoto(page)
  await expect(page.getByText('Совместите точку 1 из 4')).toBeVisible()
})
