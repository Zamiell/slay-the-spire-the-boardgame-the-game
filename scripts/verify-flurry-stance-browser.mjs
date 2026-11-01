import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/flurry-stance.spec.mjs', import.meta.url))
