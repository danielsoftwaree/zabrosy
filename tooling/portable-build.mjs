import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function buildPortable() {
  const result = await build({
    configFile: false,
    plugins: [react()],
    publicDir: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      target: 'es2022',
      minify: 'esbuild',
      lib: { entry: fileURLToPath(new URL('../src/app/portable.tsx', import.meta.url)), name: 'MarkerPortable', formats: ['iife'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const output = (Array.isArray(result) ? result[0] : result).output
  const js = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n').replace(/<\/script/gi, '<\\/script')
  const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Маркер · автономная копия</title><style>${css}</style></head><body><div id="portable-root"></div><script id="embedded-state" type="application/json">null</script><script>${js}</script></body></html>`
  await writeFile(new URL('../public/portable.html', import.meta.url), html)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildPortable()
