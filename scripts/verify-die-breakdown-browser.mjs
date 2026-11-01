import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/die-breakdown.spec.mjs', import.meta.url))
