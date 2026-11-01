import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/card-block-preview.spec.mjs', import.meta.url))
