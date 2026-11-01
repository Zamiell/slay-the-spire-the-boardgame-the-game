import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/blessing-potions.spec.mjs', import.meta.url))
