import { expect, test } from '@playwright/test'

test('account keeps guest access and reports a refused group login', async ({ page }) => {
  let loginCalls = 0
  await page.route('**/functions/v1/marker-login', async (route) => {
    loginCalls += 1
    expect(route.request().postDataJSON()).toEqual({ username: 'tester', password: 'wrong-password' })
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Неверное имя пользователя или пароль.' }),
    })
  })

  await page.goto('account')
  await expect(page.getByRole('heading', { name: 'Аккаунт' })).toBeVisible()
  const username = page.getByRole('textbox', { name: 'Имя пользователя' })
  const unavailable = page.getByText(/Облачное сохранение пока недоступно/)
  await expect(username.or(unavailable)).toBeVisible()
  if (await unavailable.isVisible()) {
    expect(loginCalls).toBe(0)
    return
  }

  await username.fill('tester')
  await page.getByLabel('Общий пароль').fill('wrong-password')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('status')).toHaveText('Неверное имя пользователя или пароль.')
  await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()
  expect(loginCalls).toBe(1)
})
