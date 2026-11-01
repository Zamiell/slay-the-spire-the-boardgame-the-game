import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/relic-refresh.spec.mjs', import.meta.url))
