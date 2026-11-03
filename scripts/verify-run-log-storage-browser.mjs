import { runBrowserSpec } from './lib/run-browser-spec.mjs'

await runBrowserSpec(new URL('./browser-tests/run-log-storage.spec.mjs', import.meta.url))
