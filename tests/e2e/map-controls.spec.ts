import { expect, test } from '@playwright/test'

test('map tools leave room for the image at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Снимок' }).click()
  await page.getByRole('button', { name: 'Измерить между точками' }).click()

  const frame = page.locator('.field-map__frame')
  const footer = page.getByRole('region', { name: 'Измерение на карте' })
  await expect(footer.getByRole('button', { name: 'Закрыть' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Участок для камеры' })).toBeInViewport()
  const imageBounds = await frame.boundingBox()
  const footerBounds = await footer.boundingBox()
  expect(imageBounds?.height).toBeGreaterThan(280)
  expect(footerBounds?.height).toBeLessThan(260)
})

test('standalone map keeps the measurement footer and zoom reachable on a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 })
  await page.goto('map')
  await page.getByRole('button', { name: 'Измерить между точками' }).click()

  const footer = page.getByRole('region', { name: 'Измерение на карте' })
  await expect(footer.getByRole('button', { name: 'Закрыть' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Приблизить' })).toBeInViewport()
  expect((await page.locator('.field-map__frame').boundingBox())?.height).toBeGreaterThan(180)
})
