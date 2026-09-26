import { expect, it } from 'vitest'
import { emptyFieldData } from '../model'
import { embedPortableData } from './portable'
it('embeds user text as JSON without breaking out into executable HTML', () => {
  const data = { ...structuredClone(emptyFieldData), unexpected: '</script><img src=x onerror=alert(1)>$&' }
  const template = '<script id="embedded-state" type="application/json">null</script><script>boot()</script>'
  const output = embedPortableData(template, data)
  expect(output.match(/<\/script>/g)).toHaveLength(2)
  expect(output).not.toContain('<img')
  const json = output.match(/application\/json">(.*?)<\/script>/)?.[1]
  expect(JSON.parse(json!).unexpected).toBe(data.unexpected)
})
