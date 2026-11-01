import { runBrowserSpec } from './lib/run-browser-spec.mjs'

await runBrowserSpec(new URL('./browser-tests/combat-view.spec.mjs', import.meta.url))
