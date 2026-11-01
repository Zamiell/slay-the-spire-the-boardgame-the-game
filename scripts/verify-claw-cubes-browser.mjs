import { runBrowserSpec } from './lib/run-browser-spec.mjs'

runBrowserSpec(new URL('./browser-tests/claw-cubes.spec.mjs', import.meta.url))
