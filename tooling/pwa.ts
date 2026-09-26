import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

// Emit during the client build so Nitro sees the final file and its real ETag.
export function pwa(base = '/'): Plugin {
  return {
    name: 'marker-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return
      const template = readFileSync(new URL('./service-worker.js.template', import.meta.url), 'utf8')
      const publicFiles = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'portable.html']
      const output = Object.values(bundle).filter((file) => !file.fileName.endsWith('.map'))
      const pages = base === '/zabrosy/' ? ['account', 'device', 'help', 'journal', 'map'].map((route) => `${base}${route}/`) : []
      const urls = [base, ...pages, ...output.map((file) => `${base}${file.fileName}`), ...publicFiles.map((name) => `${base}${name}`)].sort()
      const hash = createHash('sha256').update(template).update(base)
      for (const file of output) hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source)
      for (const name of publicFiles) hash.update(readFileSync(new URL(`../public/${name}`, import.meta.url)))
      const prefix = `marker-shell-${base.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]/gi, '-') || 'root'}-`
      const version = `${prefix}${hash.digest('hex').slice(0, 12)}`
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__CACHE_VERSION__', version).replace('__CACHE_PREFIX__', prefix).replace('__BASE_PATH__', base).replace('__PRECACHE_FILES__', JSON.stringify(urls)),
      })
    },
  }
}
