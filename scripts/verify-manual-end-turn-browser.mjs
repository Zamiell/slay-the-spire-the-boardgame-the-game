import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/manual-end-turn.spec.mjs', import.meta.url))
