import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/runic-pyramid.spec.mjs', import.meta.url))
