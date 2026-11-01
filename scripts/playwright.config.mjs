export default {
  testDir: './browser-tests',
  testMatch: '**/*.spec.mjs',
  outputDir: '../artifacts/playwright',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: 'line',
  // Animated game scenes already have video/manual screenshots; per-action DOM captures are costly.
  use: { trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false },
    launchOptions: { ...returningPlayerLaunchOptions(), args: ['--mute-audio'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false,
      video: { mode: 'on', size: { width: 1440, height: 900 } } } },
    { name: 'horizontal-phone', use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true,
      video: { mode: 'on', size: { width: 844, height: 390 } } } },
  ],
}
import { returningPlayerLaunchOptions } from './lib/profile-browser.mjs'
