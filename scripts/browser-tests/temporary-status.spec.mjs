import { test, startStandardCampaign } from '../lib/browser-test.mjs'
import assert from 'node:assert/strict'
import { postNeowRun } from '../lib/post-neow-run.mjs'
import { enterRoom } from '../../src/game/run.ts'

test.use({ appKey: import.meta.url, hasTouch: false, isMobile: false, reducedMotion: "reduce" })

test('temporary-status', async ({ page, screen, appURL, artifacts: output }) => {
  await startStandardCampaign(page, appURL)
  await page.mouse.move(2, 2)
  for (const character of ['watcher', 'defect']) for (const withTimeWarp of [false, true]) {
    const run = postNeowRun(47, [{ id: 'p1', name: character, character }])
    const room = run.map.rows[0][0]
    run.map.rooms[room].kind = 'encounter'
    const next = enterRoom(run, room)
    if (withTimeWarp) next.combat.enemies = [{ ...next.combat.enemies[0], defId: 'time_eater', isBoss: true,
      hp: 100, maxHp: 120, actionIndex: 0 }]
    next.combat.combatId = `statuses-${character}-${withTimeWarp}`
    next.combat.phase = 'player'
    Object.assign(next.combat.players[0], {
      skin: character === 'watcher' ? 'monogatari_watcher' : undefined,
      energy: 3, relics: [], powers: [], potions: [], strengthLossAtEndOfTurn: 0, drawLocked: false,
      orbs: character === 'defect' ? ['lightning', 'frost', 'dark'] : [null, null, null],
    })
    await page.evaluate(run => window.__STS_DEBUG__.setRun(run), next)
    await page.waitForFunction(id => window.__STS_DEBUG__.getRun().combat?.combatId === id, next.combat.combatId)
    const seat = page.locator('.seat[data-player-id="p1"]')
    await seat.locator('.seat__portrait > img').first().evaluate(image => image.decode())
    await page.waitForFunction(() => !document.querySelector('.combat').getAnimations({ subtree: true })
      .some(animation => animation instanceof CSSTransition && animation.transitionProperty.startsWith('--stage-') &&
        animation.playState === 'running'))
    const portrait = seat.locator('.seat__portrait')
    const before = await portrait.boundingBox()
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.players[0], { strengthLossAtEndOfTurn: 1, drawLocked: true,
        nextCardCost: 2, relics: [{ defId: 'snecko_eye', spent: false }] })
      window.__STS_DEBUG__.setRun(run)
    })
    const statuses = seat.locator('.seat__meta')
    if (withTimeWarp) assert.equal(await statuses.locator('.combat__time-warp strong').innerText(), '0/5')
    await statuses.getByText('Cannot draw more cards this turn', { exact: true }).waitFor()
    await statuses.getByText('Snecko Eye · next card costs 2 Energy', { exact: true }).waitFor()
    await page.waitForFunction(() => {
      const meta = document.querySelector('.seat__meta')
      return Number.parseFloat(meta.closest('.seat__interactive').style.getPropertyValue('--temporary-status-height')) === meta.offsetHeight
    })
    const geometry = await statuses.evaluate(meta => {
      const box = meta.getBoundingClientRect()
      const board = meta.closest('.board').getBoundingClientRect()
      return {
        overflow: getComputedStyle(meta).overflowX,
        width: meta.clientWidth, scrollWidth: meta.scrollWidth,
        height: meta.clientHeight, scrollHeight: meta.scrollHeight,
        top: box.top, bottom: box.bottom, boardTop: board.top, boardBottom: board.bottom,
        descriptionsHidden: [...meta.querySelectorAll('.visually-hidden')].every(description => {
          const rect = description.getBoundingClientRect()
          return rect.width <= 1 && rect.height <= 1 && getComputedStyle(description).clipPath === 'inset(50%)'
        }),
        visible: box.left >= Math.max(0, board.left) && box.right <= Math.min(innerWidth, board.right) &&
          box.top >= Math.max(0, board.top) && box.bottom <= Math.min(innerHeight, board.bottom),
        chipsFit: [...meta.children].filter(chip => !chip.classList.contains('visually-hidden')).every(chip => {
          const rect = chip.getBoundingClientRect()
          return rect.left >= box.left - 1 && rect.right <= box.right + 1 &&
            rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 &&
            chip.scrollWidth <= chip.clientWidth + 1 && chip.scrollHeight <= chip.clientHeight + 1
        }),
        orbsClear: [...meta.closest('.seat__interactive').querySelectorAll('.orbs .token--orb')].every(orb => {
          const rect = orb.getBoundingClientRect()
          return rect.bottom + rect.height * 0.16 + 4 <= box.top && rect.top >= board.top
        }),
      }
    })
    await page.screenshot({ path: `${output}/${screen}-${character}${withTimeWarp ? '-time-warp' : ''}.png` })
    assert(!['auto', 'scroll'].includes(geometry.overflow), 'temporary statuses must not create a scroll container')
    assert(geometry.scrollWidth <= geometry.width + 1 && geometry.scrollHeight <= geometry.height + 1 &&
      geometry.chipsFit && geometry.descriptionsHidden && geometry.visible && geometry.orbsClear,
    `${screen}/${character}: statuses must remain readable without clipping or covering Orbs: ${JSON.stringify(geometry)}`)
    const after = await portrait.boundingBox()
    for (const key of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(before[key] - after[key]) < 1, 'wrapping statuses must not move or resize the hero')
    }
    await page.evaluate(() => {
      const run = structuredClone(window.__STS_DEBUG__.getRun())
      Object.assign(run.combat.players[0], { strengthLossAtEndOfTurn: 0, drawLocked: false, nextCardCost: null })
      run.combat.enemies[0].defId = 'jaw_worm'
      window.__STS_DEBUG__.setRun(run)
    })
    await statuses.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelector('.seat__meta').closest('.seat__interactive').style
      .getPropertyValue('--temporary-status-height') === '0px')
  }
  console.log(`PASS ${screen}: wrapped temporary statuses, no scrollbar, stable hero and clear Orbs`)
})
