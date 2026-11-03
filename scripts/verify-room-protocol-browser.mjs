import { runBrowserSpec } from './lib/run-browser-spec.mjs'

await runBrowserSpec(new URL('./browser-tests/room-protocol.spec.mjs', import.meta.url))
