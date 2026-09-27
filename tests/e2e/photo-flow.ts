import { expect, type Page } from '@playwright/test'

/** Complete the same map preparation a user needs before marking a photograph. */
export async function preparePhotoArea(page: Page) {
  const map = page.getByRole('button', { name: /Снимок участка/ })
  await expect(map).toBeVisible()
  const touch = async (x: number, y: number) => {
    const box = await map.boundingBox()
    if (!box) throw new Error('Map is not visible')
    await map.click({ position: { x: box.width * x, y: box.height * y } })
  }
  await page.getByRole('button', { name: 'Измерить между точками' }).click()
  await touch(.3, .55)
  await expect(page.locator('.map-hint')).toContainText('Теперь отметьте второй берег')
  await touch(.7, .35)
  await expect(page.locator('.map-footer__distance')).toContainText('м')
  await page.getByRole('button', { name: 'Привязать фото' }).click()
  const anchors = [[.3, .55], [.7, .55], [.7, .35], [.3, .35]]
  const nextStep = ['Ближняя кромка воды: точка справа', 'Дальняя кромка воды: точка справа', 'Дальняя кромка воды: точка слева', 'Выберите эти же четыре точки']
  for (let index = 0; index < anchors.length; index++) {
    await touch(anchors[index][0], anchors[index][1])
    await expect(page.locator('.map-hint')).toContainText(nextStep[index])
  }
  await page.getByRole('button', { name: 'Перейти к фото' }).click()
  await expect(page.getByText('Снимите оба берега')).toBeVisible()
}

export async function uploadSamplePhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640; canvas.height = 480
    const context = canvas.getContext('2d')!
    context.fillStyle = '#799a8c'; context.fillRect(0, 0, 640, 480)
    return canvas.toDataURL('image/png')
  })
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'river.png', mimeType: 'image/png', buffer: bytes })
  await expect(page.locator('canvas.photo-canvas')).toBeVisible()
}
