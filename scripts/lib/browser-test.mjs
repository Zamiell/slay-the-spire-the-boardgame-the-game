import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { baseTest, silenceContext } from './silent-browser.mjs'
import { seedReturningPlayer } from './profile-browser.mjs'

export { expect } from './silent-browser.mjs'

export async function startStandardCampaign(page, url) {
  await page.goto(url)
  for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign'])
    await page.getByRole('button', { name, exact: true }).click()
  await page.waitForFunction(() => window.__STS_DEBUG__?.getRun().phase === 'neow')
}

export const test = baseTest.extend({
  appKey: ['', { scope: 'worker', option: true }],
  context: async ({ context }, use) => {
    await silenceContext(context)
    await seedReturningPlayer(context)
    await use(context)
  },
  appURL: [async ({ appKey }, use) => {
    void appKey
    const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
    await server.listen()
    try { await use(`http://127.0.0.1:${server.httpServer.address().port}`) }
    finally { await server.close() }
  }, { scope: 'worker' }],
  baseURL: async ({ appURL }, use) => { await use(appURL) },
  screen: async ({}, use, info) => { await use(info.project.name) },
  phone: async ({}, use, info) => { await use(info.project.name === 'horizontal-phone') },
  browserErrors: [async ({ page }, use) => {
    const errors = []
    const record = error => errors.push(error.message)
    page.on('pageerror', record)
    try { await use() } finally {
      page.off('pageerror', record)
      assert.deepEqual(errors, [], 'uncaught browser errors')
    }
  }, { auto: true }],
})
