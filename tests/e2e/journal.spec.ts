import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Backup = { kind: string; version: number; data: { sessions: { id: string; name: string }[]; casts: unknown[] } }

async function exportJson(page: import('@playwright/test').Page): Promise<Backup> {
  const transfers = page.locator('details[aria-label="Перенос данных"]')
  if (!await transfers.evaluate((node) => (node as HTMLDetailsElement).open)) await transfers.locator('summary').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('marker-backup.json')
  const path = await download.path()
  if (!path) throw new Error('JSON backup was not downloaded')
  return JSON.parse(await readFile(path, 'utf8')) as Backup
}

test('JSON backup previews and imports as a copy without replacing the session', async ({ page }) => {
  await page.goto('journal')
  await page.locator('details[aria-label="Сессии"] > summary').click()
  await page.getByRole('textbox', { name: 'Название новой сессии' }).fill('Цегелинка — тест')
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.locator('.journal-session')).toHaveCount(1)

  const original = await exportJson(page)
  expect(original.kind).toBe('marker-backup')
  expect(original.version).toBe(1)
  expect(original.data.sessions).toHaveLength(1)
  const originalId = original.data.sessions[0].id

  await page.locator('input[type="file"][accept*=".html"]').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)),
  })
  await expect(page.getByText('Копия готова к добавлению')).toBeVisible()
  await expect(page.locator('.journal-preview')).toContainText('1 сессий, 0 забросов')
  await page.getByRole('button', { name: 'Импортировать копиями' }).click()
  await expect(page.locator('.journal-session')).toHaveCount(2)

  const merged = await exportJson(page)
  expect(merged.data.sessions).toHaveLength(2)
  expect(merged.data.sessions.map((session) => session.name)).toEqual(['Цегелинка — тест', 'Цегелинка — тест'])
  expect(new Set(merged.data.sessions.map((session) => session.id)).size).toBe(2)
  expect(merged.data.sessions.some((session) => session.id === originalId)).toBe(true)
  await page.reload()
  await expect(page.locator('.journal-session')).toHaveCount(2)
})

test('GeoJSON depth points keep source and datum and appear in the bottom map', async ({ page }) => {
  await page.route('https://mapy.geoportal.gov.pl/**', route => route.abort())
  await page.goto('journal')
  await page.locator('details[aria-label="Точки глубин"] > summary').click()
  await page.getByRole('textbox', { name: 'Название набора' }).fill('Цегелинка — точки карты')
  await page.getByRole('textbox', { name: 'Источник' }).fill('Тестовый промер')
  await page.getByRole('textbox', { name: 'Вертикальный датум' }).fill('Ноль источника')
  const feature = (lon: number, lat: number, depthM: number) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { depthM },
  })
  const chart = { type: 'FeatureCollection', features: [
    feature(14.6190, 53.3866, 2.4), feature(14.6192, 53.3866, 2.9), feature(14.6191, 53.3868, 3.1),
  ] }
  await page.locator('input[type="file"][accept*=".geojson"]').setInputFiles({
    name: 'cegielinka.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(chart)),
  })
  await expect(page.locator('.journal-preview')).toContainText('3 точек · Тестовый промер · датум: Ноль источника')
  await page.getByRole('button', { name: 'Сохранить точки' }).click()
  await expect(page.getByText('Карта глубин сохранена локально.')).toBeVisible()

  await page.goto('map')
  await page.getByRole('group', { name: 'Представление карты' }).getByRole('button', { name: 'Дно' }).click()
  await page.getByRole('button', { name: 'Настройки рельефа' }).click()
  const settings = page.getByRole('dialog', { name: 'Настройки рельефа' })
  await settings.getByRole('radio', { name: 'Цегелинка — точки карты' }).check()
  await expect(settings.getByText(/Тестовый промер · отсчёт: Ноль источника/)).toBeVisible()
  await settings.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('img', { name: 'План 3 точек глубин' })).toBeVisible()
  await expect(page.locator('.depth-summary')).toContainText('3 из 3 точек')
  await page.reload()
  await page.getByRole('group', { name: 'Представление карты' }).getByRole('button', { name: 'Дно' }).click()
  await page.getByRole('button', { name: 'Настройки рельефа' }).click()
  await page.getByRole('dialog', { name: 'Настройки рельефа' }).getByRole('radio', { name: 'Цегелинка — точки карты' }).check()
  await page.getByRole('dialog', { name: 'Настройки рельефа' }).getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('img', { name: 'План 3 точек глубин' })).toBeVisible()
})

test('concurrent journal tabs retain both new sessions', async ({ page, context }) => {
  const other = await context.newPage()
  await Promise.all([page.goto('journal'), other.goto('journal')])
  await Promise.all([
    page.locator('details[aria-label="Сессии"] > summary').click(),
    other.locator('details[aria-label="Сессии"] > summary').click(),
  ])
  await Promise.all([
    expect(page.getByRole('textbox', { name: 'Название новой сессии' })).toBeVisible(),
    expect(other.getByRole('textbox', { name: 'Название новой сессии' })).toBeVisible(),
  ])
  await page.getByRole('textbox', { name: 'Название новой сессии' }).fill('Первая вкладка')
  await other.getByRole('textbox', { name: 'Название новой сессии' }).fill('Вторая вкладка')
  await Promise.all([
    page.getByRole('button', { name: 'Создать' }).click(),
    other.getByRole('button', { name: 'Создать' }).click(),
  ])
  await expect(page.locator('.journal-session')).toHaveCount(2)
  await expect(other.locator('.journal-session')).toHaveCount(2)
  const backup = await exportJson(page)
  expect(backup.data.sessions.map((session) => session.name).sort()).toEqual(['Вторая вкладка', 'Первая вкладка'])
  await other.close()
})
