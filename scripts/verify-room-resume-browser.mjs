import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from './lib/profile-browser.mjs'
import { createRun, enterRoom } from '../src/game/run.ts'
import { EVENT_CARDS } from '../src/game/events.ts'
import { createRng } from '../src/game/rng.ts'

const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch()
let sequence = 0
function arrival(kind, eventId) {
  const run = createRun(47, [{ id: 'p1', name: 'Room reset', character: 'ironclad' }])
  run.campaign.runId = `room-resume-${sequence++}`
  run.phase = 'map'
  run.neow = null
  run.players[0].gold = 30
  run.players[0].relics = []
  run.players[0].potions = []
  const node = run.map.rows[0][0]
  run.map.rooms[node].kind = kind
  if (eventId) {
    const event = EVENT_CARDS.find(card => card.id === eventId)
    assert(event, eventId)
    run.eventDeck = [event, ...run.eventDeck.filter(card => card.id !== eventId)]
    run.eventsVisited = 1
  }
  const entered = enterRoom(run, node)
  assert.notEqual(entered, run)
  if (kind === 'merchant') entered.roomState.relics[0] = 'whetstone'
  if (eventId === 'scrap_ooze') entered.rng = createRng(7)
  return entered
}

try {
  for (const [screen, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['horizontal-phone', { width: 844, height: 390 }],
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
    page.setDefaultTimeout(15_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    for (const name of ['Single Player', 'Standard', 'Embark', 'Start standard campaign']) {
      await page.getByRole('button', { name, exact: true }).click()
    }
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sts-solo-run')))
    const read = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__STS_DEBUG__.getRun())))
    const waitSave = () => page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('sts-solo-run') ?? 'null')
      return saved && JSON.stringify(saved.run) === JSON.stringify(window.__STS_DEBUG__.getRun())
    })
    const stage = async run => {
      await page.evaluate(async run => {
        const { startRunLog } = await import('/src/ui/run-log.ts')
        if (!await startRunLog(run)) throw new Error('Could not persist the fixture run log')
        window.__STS_DEBUG__.setRun(run)
      }, run)
      await page.waitForFunction(id => window.__STS_DEBUG__.getRun().campaign.runId === id, run.campaign.runId)
      await waitSave()
      const opening = await read()
      assert.deepEqual((await saved()).roomStart, opening, 'arrival must capture the entire run before any decisions')
      return opening
    }
    const resume = async expected => {
      await page.reload()
      await page.getByRole('button', { name: 'Resume', exact: true }).click()
      try {
        await page.waitForFunction(({ id, phase }) => {
          const run = window.__STS_DEBUG__.getRun()
          return run.campaign.runId === id && run.phase === phase
        }, { id: expected.campaign.runId, phase: expected.phase })
      } catch (cause) {
        throw new Error(`Resume did not restore ${expected.campaign.runId}/${expected.phase}: ${
          (await page.locator('body').innerText()).slice(0, 2000)}`, { cause })
      }
      assert.deepEqual(await read(), expected, 'reload must restore the whole checkpoint, including RNG and supplies')
      await waitSave()
    }
    const purchasePotion = async () => {
      await page.getByRole('button', { name: 'Enter merchant shop', exact: true }).click()
      await page.locator('[data-merchant-target="potion-0"]').click()
      await page.waitForFunction(() => window.__STS_DEBUG__.getRun().players[0].potions.length === 1)
    }

    const shop = await stage(arrival('merchant'))
    await purchasePotion()
    await page.locator('.merchant-cards .card').first().click()
    await page.waitForFunction(count => window.__STS_DEBUG__.getRun().players[0].deck.length === count + 1,
      shop.players[0].deck.length)
    await page.evaluate(async () => {
      const { removeAtCurrentMerchant } = await import('/src/game/run.ts')
      const { merchantRemovalCost } = await import('/src/game/acquisition.ts')
      const run = window.__STS_DEBUG__.getRun()
      const next = removeAtCurrentMerchant(run, 'p1', run.players[0].deck[0].uid, { p1: merchantRemovalCost(run.ascension) })
      if (next === run) throw new Error('Card removal fixture was refused')
      window.__STS_DEBUG__.setRun(next)
    })
    await page.locator('[data-merchant-target="relic-0"]').click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().players[0].relics.some(relic => relic.pending))
    await waitSave()
    assert((await read()).players[0].gold < shop.players[0].gold)
    assert.deepEqual((await saved()).roomStart, shop, 'purchases and acquisition screens must not replace the arrival')
    await resume(shop)
    await resume(shop)
    await purchasePotion()
    const purchased = await read()
    await page.getByRole('button', { name: /Leave shop/ }).click()
    await page.locator('.merchant-arrival').waitFor()
    assert.deepEqual((await saved()).roomStart, shop, 'closing the shop UI does not leave its map node')
    await page.locator('.merchant-arrival .room-proceed').click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    await waitSave()
    const leftShop = await read()
    assert.equal((await saved()).roomStart, null, 'leaving the shop commits the visit')
    await resume(leftShop)
    assert.equal((await read()).players[0].gold, purchased.players[0].gold)
    assert.deepEqual((await read()).players[0].potions, purchased.players[0].potions)

    const event = await stage(arrival('event', 'scrap_ooze'))
    await page.getByRole('button', { name: /Reach Inside/ }).click()
    await page.getByRole('button', { name: 'Reach again', exact: true }).waitFor()
    await waitSave()
    const missed = await read()
    assert(missed.players[0].hp < event.players[0].hp)
    assert.deepEqual(missed.roomState.dieRolls.p1, [1])
    assert.deepEqual((await saved()).roomStart, event)
    // Older saves have no embedded room snapshot; recover it from replay history.
    assert(await page.evaluate(async () => {
      const { readRunLog, applyRunLogEvent } = await import('/src/ui/run-log.ts')
      const run = window.__STS_DEBUG__.getRun()
      const log = await readRunLog(run.campaign.runId)
      return log && JSON.stringify(log.events.reduce(applyRunLogEvent, log.initial)) === JSON.stringify(run)
    }), 'the complete Event history must be persisted before testing legacy recovery')
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sts-solo-run'))
      delete saved.roomStart
      localStorage.setItem('sts-solo-run', JSON.stringify(saved))
    })
    await resume(event)
    await page.getByRole('button', { name: /Reach Inside/ }).click()
    await page.getByRole('button', { name: 'Reach again', exact: true }).waitFor()
    assert.deepEqual((await read()).roomState.dieRolls.p1, [1], 'restoring RNG must replay the same roll')
    await page.locator('.event-options--retry').getByRole('button', { name: 'Leave', exact: true }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'map')
    await waitSave()
    const leftEvent = await read()
    assert.equal((await saved()).roomStart, null)
    await resume(leftEvent)

    const merchantEvent = await stage(arrival('event', 'merchant'))
    await page.getByRole('button', { name: /\[Shop\]/ }).click()
    await purchasePotion()
    await waitSave()
    assert.deepEqual((await saved()).roomStart, merchantEvent, 'an Event shop still belongs to the original Event')
    await resume(merchantEvent)
    const fightEvent = await stage(arrival('event', 'colosseum'))
    await page.getByRole('button', { name: /\[Warm Up\]/ }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    await waitSave()
    assert.deepEqual((await saved()).roomStart, fightEvent, 'an Event fight must retain the original Event checkpoint')
    await resume(fightEvent)
    await page.getByRole('button', { name: /\[Warm Up\]/ }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.phase = 'won'
      for (const enemy of run.combat.enemies) { enemy.hp = 0; enemy.dead = true }
      window.__STS_DEBUG__.setRun(run)
    })
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'reward')
    await waitSave()
    assert((await saved()).lootStart)
    await resume(fightEvent)
    // An Event can finish before its mandatory relic acquisition is resolved.
    await page.evaluate(async () => {
      const { gainRelic } = await import('/src/game/acquisition.ts')
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.players[0] = gainRelic(run.players[0], 'whetstone')
      run.phase = 'map'
      run.roomState = null
      window.__STS_DEBUG__.setRun(run)
    })
    await waitSave()
    assert.deepEqual((await saved()).roomStart, fightEvent, 'unfinished acquisitions must keep the Event checkpoint')
    await resume(fightEvent)
    await page.getByRole('button', { name: /\[Warm Up\]/ }).click()
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().combat?.phase === 'player')
    const lostCheckpoint = await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      run.combat.phase = 'lost'
      run.combat.players[0].hp = 0
      run.combat.players[0].dead = true
      window.__STS_DEBUG__.setRun(run)
      return JSON.parse(localStorage.getItem('sts-solo-run')).roomStart
    })
    assert.equal(lostCheckpoint, null, 'an Event loss must not become a new way to undo a terminal defeat')
    await page.waitForFunction(() => window.__STS_DEBUG__.getRun().phase === 'defeat')
    await waitSave()
    await resume(await read())

    const quickShop = arrival('merchant')
    quickShop.map.position = null
    quickShop.setup = { kind: 'quick-start', targetAct: 2, playerIds: ['p1'], rowIndex: 10,
      repeatIndex: 0, playerIndex: 0, die: null }
    const quickOpening = await stage(quickShop)
    await purchasePotion()
    await waitSave()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'Slay the Spire', exact: true })
      .getByRole('button', { name: 'Return to main menu', exact: true }).click()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.merchant-arrival').waitFor()
    assert.deepEqual(await read(), quickOpening, 'menu resume must also rewind Quick Start shops')
    await waitSave()
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sts-solo-run'))
      delete saved.roomStart
      saved.run.campaign.runId += '-missing-history'
      localStorage.setItem('sts-solo-run', JSON.stringify(saved))
    })
    const unrecoverable = await page.evaluate(() => localStorage.getItem('sts-solo-run'))
    await page.reload()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.getByText(/beginning of this shop or event could not be recovered/).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('sts-solo-run')), unrecoverable,
      'failed legacy recovery must not overwrite the saved run with a fake opening')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${screen}: shop/event rewind, completed visits, nested shops/fights, legacy recovery and Quick Start`)
  }
} finally {
  await browser.close()
  await server.close()
}
