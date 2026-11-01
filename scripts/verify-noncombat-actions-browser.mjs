import { runBrowserSpec } from './lib/run-browser-spec.mjs'

await runBrowserSpec(new URL('./browser-tests/noncombat-actions.spec.mjs', import.meta.url))
