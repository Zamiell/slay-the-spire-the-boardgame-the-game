import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/resource-tooltips.spec.mjs', import.meta.url))
