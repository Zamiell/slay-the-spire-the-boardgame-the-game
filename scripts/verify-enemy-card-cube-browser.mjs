import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/enemy-card-cube.spec.mjs', import.meta.url))
