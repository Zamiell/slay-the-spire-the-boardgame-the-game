import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/deck-inspection.spec.mjs', import.meta.url))
