import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/incoming-damage.spec.mjs', import.meta.url))
