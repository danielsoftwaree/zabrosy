import { createBuilder } from 'vite'
import { buildPortable } from './portable-build.mjs'

await buildPortable()

await (await createBuilder({}, null)).buildApp()

// Nitro 3.0.0 keeps its prerender preview child alive after Vite closes.
// The build and shell are already written; exiting releases that child.
process.exit(0)
