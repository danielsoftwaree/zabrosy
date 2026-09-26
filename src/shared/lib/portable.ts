import type { FieldData } from '../model'

declare global { interface Window { markerPortableTemplate?: string } }
export function embedPortableData(template: string, data: FieldData): string {
  const json = JSON.stringify({ ...data, sync: { ...data.sync, enabled: false } }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const marker = /(<script id="embedded-state" type="application\/json">)[\s\S]*?(<\/script>)/
  if (!marker.test(template)) throw new Error('Шаблон автономной копии повреждён. Повторите загрузку приложения.')
  return template.replace(marker, (_match, open: string, close: string) => `${open}${json}${close}`)
}
export async function downloadPortable(data: FieldData): Promise<void> {
  let template = window.markerPortableTemplate
  if (!template) {
    const response = await fetch(`${import.meta.env.BASE_URL}portable.html`)
    if (!response.ok) throw new Error('Автономный шаблон недоступен. Откройте приложение онлайн и повторите экспорт.')
    template = await response.text()
  }
  const html = embedPortableData(template, data)
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `marker-${new Date().toISOString().slice(0, 10)}.html`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
