import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { createBuilder } from 'vite'
import { buildPortable } from './portable-build.mjs'

const base = '/zabrosy/'
const output = new URL('../dist-pages/', import.meta.url)
const source = new URL('../.output/public/', import.meta.url)

process.env.PAGES_BUILD = '1'
await buildPortable()
await (await createBuilder({}, null)).buildApp()

await rm(output, { recursive: true, force: true })
await cp(source, output, { recursive: true })
const shell = await readFile(new URL('_shell.html', output))
await Promise.all([
  writeFile(new URL('404.html', output), shell),
  writeFile(new URL('.nojekyll', output), ''),
])
// Start prerenders these routes with path-correct markup; the generic shell
// would cause a hydration mismatch on direct navigation.
await readFile(new URL('index.html', output))
for (const route of ['account', 'device', 'help', 'journal', 'map']) {
  await readFile(new URL(`${route}/index.html`, output))
}

const manifestFile = new URL('manifest.webmanifest', output)
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
manifest.start_url = base
manifest.scope = base
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `${base}${icon.src.replace(/^\//, '')}` }))
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

// Nitro currently retains its prerender child after Vite closes.
process.exit(0)
