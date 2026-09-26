import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { pwa } from './pwa'

const pagesBuild = process.env.PAGES_BUILD === '1'
const base = pagesBuild ? '/zabrosy/' : '/'
const staticRoutes = ['account', 'device', 'help', 'journal', 'map']

export default defineConfig({
  base,
  server: { port: 3000 },
  plugins: [
    tanstackStart({
      spa: { enabled: true },
      ...(pagesBuild ? { pages: [
        { path: base, prerender: { enabled: true, outputPath: '/', crawlLinks: false } },
        ...staticRoutes.map((route) => ({ path: `${base}${route}`, prerender: { enabled: true, crawlLinks: false } })),
      ] } : {}),
    }),
    nitro(),
    viteReact(),
    pwa(base),
    {
      name: 'wait-for-nitro-preview',
      // ponytail: Nitro 3.0.0 exposes its preview proxy before its child listens.
      // This 2s wait covers current startup; remove once Nitro awaits readiness.
      async configurePreviewServer() {
        if (process.env.TSS_PRERENDERING) await new Promise((resolve) => setTimeout(resolve, 2000))
      },
    },
  ],
})
