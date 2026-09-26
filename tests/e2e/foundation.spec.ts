import { expect, test } from '@playwright/test'

test('guest opens device diagnostics without cloud configuration', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('device')
  await expect(page.getByRole('button', { name: 'Включить датчики' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить GPS' })).toBeVisible()
  await expect(page.getByText('Датчики выключены.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('permission denial keeps manual navigation available', async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ['DeviceOrientationEvent', 'DeviceMotionEvent']) {
      Object.defineProperty(window, name, {
        configurable: true,
        value: { requestPermission: async () => 'denied' },
      })
    }
  })
  await page.goto('device')
  await page.getByRole('button', { name: 'Включить датчики' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Ориентация:' })).toContainText('Доступ отклонён')
  await page.getByRole('button', { name: 'Остановить' }).click()
  await expect(page.getByRole('button', { name: 'Включить датчики' })).toBeEnabled()
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Начать промер' })).toBeVisible()
})

test('first install precaches the shell and unopened routes for offline use', async ({ page, context }) => {
  await page.goto('./')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Начать промер' })).toBeVisible()
  await page.goto('device')
  await expect(page.getByRole('button', { name: 'Включить датчики' })).toBeVisible()
  await page.goto('account')
  await expect(page.getByRole('heading', { name: 'Аккаунт' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Имя пользователя' }).or(page.getByText(/Облачное сохранение пока недоступно/))).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Без сети' })).toBeVisible()
})
