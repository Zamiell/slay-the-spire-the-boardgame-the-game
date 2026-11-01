import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/relic-action-icons.spec.mjs', import.meta.url))
