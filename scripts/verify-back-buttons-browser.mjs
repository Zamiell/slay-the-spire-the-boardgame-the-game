import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/back-buttons.spec.mjs', import.meta.url))
