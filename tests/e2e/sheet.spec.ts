import { expect, test } from '@playwright/test'

test('menu sheet keeps its heading reachable while content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Меню и настройки' }).click()

  const popup = page.getByRole('dialog')
  await expect(popup.getByRole('heading', { name: 'У воды' })).toBeVisible()
  const content = popup.locator('.sheet-content')
  await expect.poll(() => content.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await content.evaluate((node) => { node.scrollTop = node.scrollHeight })
  await expect(popup.getByRole('heading', { name: 'У воды' })).toBeInViewport()
  await expect(popup.getByRole('button', { name: 'Закрыть' })).toBeInViewport()

  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
})
