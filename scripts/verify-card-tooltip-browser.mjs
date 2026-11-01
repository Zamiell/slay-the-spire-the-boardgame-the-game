import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/card-tooltip.spec.mjs', import.meta.url))
