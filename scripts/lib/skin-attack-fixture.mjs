// Real engine events rendered by the production combat screen; no synthetic attacks.
// The hero wears a skin with a staged attack: the hero's own cards play, the skin's animation shows.
export async function installAttackFixture({ character, skin, strike = `strike_${character}` }) {
  document.querySelector('#root').style.display = 'none'
  document.documentElement.dataset.mobilePerformance = String(innerWidth < 900)
  document.documentElement.dataset.reducedMotion = 'false'
  const node = document.createElement('div')
  node.className = 'app-shell app-shell--combat sts-scope'
  node.style.gridTemplateRows = 'minmax(0, 1fr)'
  document.body.append(node)
  const [R, D, DOM, { CombatScreen }, { createPlayer }, { createCombat, playCard, spendShiv }, { createRng }] = await Promise.all([
    import('/@id/react'), import('/@id/react-dom/client'), import('/@id/react-dom'),
    import('/src/ui/CombatScreen.tsx'), import('/src/game/run.ts'), import('/src/game/combat.ts'),
    import('/src/game/rng.ts'), import('/src/ui/styles.css'), import('/src/ui/chrome.css'),
  ])
  const root = (D.createRoot ?? D.default.createRoot)(node)
  const flushSync = DOM.flushSync ?? DOM.default.flushSync
  const f = window.attackFixture = { restoration: 0, run: 0, connected: true, character, skin }
  f.render = () => flushSync(() => root.render((R.createElement ?? R.default.createElement)(CombatScreen, {
    state: structuredClone(f.state), act: 1, viewerId: 'p1', autoAdvance: false,
    authoritativeRestoration: f.restoration, authoritativeConnected: f.connected, onAction: () => {},
  })))
  f.reset = (hero = f.character, wear = f.skin) => {
    const rng = createRng(47)
    const player = createPlayer(rng, 'p1', 'ArtTest', hero, 0, [], undefined, undefined, [], wear)
    Object.assign(player, { hand: [], draw: [], relics: [], energy: 9 })
    const enemies = [0, 1].map(i => ({ uid: `enemy-${i}`, defId: 'jaw_worm', row: 0, isBoss: false,
      hp: 30, maxHp: 30, block: 0, strength: 0, vulnerable: 0, weak: 0, poison: 0,
      actionIndex: 0, abilityUsed: true, dead: false }))
    f.state = createCombat(rng, [player], enemies, `skin-attack-${++f.run}`)
    f.state.phase = 'player'
    f.state.players[0].energy = 9
    f.state.presentationEvents = []
    f.connected = true
    f.restoration++
    f.render()
  }
  // `command`: the enemy a Slime Command in the card hits (the party's first Slime acts).
  f.attack = (id = strike, { command } = {}) => {
    if (id === 'shiv') {
      f.state.players[0].shivs++
      f.state = spendShiv(f.state, 'p1', 'enemy-0')
    } else {
      const held = { uid: `art-${f.run}-${f.state.presentationEvents.length}`, defId: id, upgraded: false }
      f.state.players[0].hand.push(held)
      f.state = playCard(f.state, 'p1', held.uid, { enemyUid: 'enemy-0', row: 0,
        ...(command && { slimeUids: [f.state.players[0].slimes[0].card.uid], slimeEnemyUids: [command] }) })
    }
    f.render()
    // A card can add more events after the hero's own (a Slime Command); the attack is the card's or Shiv's.
    return f.state.presentationEvents.findLast(event => event.kind === 'card' || event.kind === 'shiv').seq
  }
  f.reset()
}

// Alpha bounds in rendered CSS pixels, including contain fit and overscan scale.
export function paintedBounds(selector) {
  const image = document.querySelector(selector)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width, top = canvas.height, right = 0, bottom = 0
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (data[(y * canvas.width + x) * 4 + 3] <= 96) continue
    left = Math.min(left, x); right = Math.max(right, x + 1)
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1)
  }
  const rect = image.getBoundingClientRect()
  const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height)
  return { width: (right - left) * fit, height: (bottom - top) * fit,
    ground: rect.bottom - (canvas.height - bottom) * fit,
    source: image.src, canvas: [rect.width, rect.height] }
}

// A dev server for the verifier: the production app plus the synthetic staged-attack skins of
// scripts/animation/test-skins, drawn by `skin-attack.py --fixture` into a scratch directory.
// Their registration, generated table and assets reach the page without touching production source.
export async function startAttackServer(root) {
  const [{ createServer }, { spawnSync }, { copyFileSync, mkdirSync, readFileSync }, { join }, { testSkinsPlugin, scratchDir }] = await Promise.all([
    import('vite'), import('node:child_process'), import('node:fs'), import('node:path'), import('./test-skins.mjs'),
  ])
  const scratch = scratchDir('skin-attack-fixture')
  const made = spawnSync('python3', [join(root, 'scripts/animation/skin-attack.py'), '--fixture', scratch.dir], { encoding: 'utf8' })
  if (made.status !== 0) { scratch.remove(); throw new Error(made.stderr || made.stdout) }
  const fixture = JSON.parse(readFileSync(join(scratch.dir, 'staged-attacks.json'), 'utf8'))
  const css = readFileSync(join(scratch.dir, 'staged-attacks.css'), 'utf8')
  // Sounds are existing recordings under the synthetic names the table asks for.
  mkdirSync(join(scratch.dir, 'assets/sfx'), { recursive: true })
  for (const sound of Object.keys(fixture.sounds)) {
    copyFileSync(join(root, 'public/assets/sfx/kratos-light.mp3'), join(scratch.dir, `assets/sfx/${sound}.mp3`))
  }
  const skins = Object.values(fixture.configs).map(config => ({
    id: config.skin, character: config.character, label: config.label, traits: { energyOrb: false, stagedAttack: true } }))
  const table = join(root, 'src/ui/combat-screen/staged-attacks.ts')
  const stagedTable = {
    name: 'staged-attack-fixture', enforce: 'pre', apply: 'serve',
    transform(code, id) {
      if (id.split('?')[0] !== table) return null
      return { code: `${code}\nObject.assign(STAGED_ATTACKS, ${JSON.stringify(fixture.table)})\n` +
        `Object.assign(STAGED_SOUND_VOLUMES, ${JSON.stringify(fixture.sounds)})\n`, map: null }
    },
  }
  const server = await createServer({ root, logLevel: 'silent', server: { port: 0 },
    plugins: [testSkinsPlugin(skins, { assetsDir: join(scratch.dir, 'assets') }), stagedTable] })
  await server.listen()
  return { origin: `http://localhost:${server.httpServer.address().port}`, fixture, css, dir: scratch.dir,
    close: async () => { await server.close(); scratch.remove() } }
}
