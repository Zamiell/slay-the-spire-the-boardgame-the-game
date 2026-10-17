# Skin requirements

A skin changes how one hero looks and sounds, never how it plays. Rules, RNG, saves and
hashes never read a skin. Five skins ship, one or more for every base hero: Kratos (Ironclad's, id `kratos`),
Ironclad-chan (`monogatari_ironclad`), Silent-chan (`monogatari_silent`), Defect-chan (`monogatari_defect`) and
Watcher-chan (`monogatari_watcher`), the last four drawn in the style of the Monogatari anime series. Kratos, Silent-chan
and Watcher-chan are the references for a skin with a staged attack (below); Ironclad-chan and Defect-chan
(`docs/monogatari-skins/`) are the references for a pose-pair attack. Copy their file names and checks when you add the next one.
Every skin's provenance and pipeline docs are indexed in `docs/skins/README.md`.

Naming rule: a skin's assets live in the same folders and filename patterns as a
character's, with the **skin id** in place of the character id (`kratos-hero.webp`,
`portrait-kratos.png`, ...). The game keys art by a *visual id*: the skin id when a valid
skin is worn, otherwise the character id (`visualId()` in `src/game/skins.ts`).

## 1. Identity (code): the registration steps

A new skin needs exactly these edits; nothing else enumerates skins by hand.

- [ ] `src/game/skins.ts`: add the skin to `SKINS` (`<character>: ['<skin>']`), `SKIN_LABELS` and
  `SKIN_TRAITS`. Profile, lobby, saves, rooms, run logs and validators pick it up from `SKINS`;
  `SKIN_LABELS` and `SKIN_TRAITS` are `Record<SkinId, ...>`, so `tsc -b` fails until they exist.
  Traits are what code reads by visual id instead of testing a literal skin id:
  `energyOrb` (the skin paints `combat/energy-orbs/<skin>.webp` and the HUD swaps the orb) and
  `stagedAttack` (its attack animation damages enemies hit by hit, so the HP drop waits for it).
- [ ] `src/ui/combat-vfx.ts` (`skinAttack`) and `src/ui/combat-sfx.ts` (`SKIN_RATE`): optional per-skin
  overrides; a skin without an entry looks and sounds like the hero it dresses.
- [ ] `src/ui/hero-art-head.json` and `scripts/calibrate-hero-head.py`: the hero-head point of the
  new idle art (hero potions and heads are positioned from it; `verify-assets.mjs` fails without it).
- [ ] `node scripts/sync-skin-card-faces.mjs` after the card art exists: regenerates
  `src/game/skin-card-faces.ts`, which lists the cards the skin has faces for.
  `verify-assets.mjs` runs the same comparison (`--check` mode), so a stale module fails it.
- [ ] Campfire sprite (rules in `docs/skins/campfire-scenes.md`): generate one seated sprite with
  `python3 scripts/art/campfire-sitters.py generate <visual>`, accept a candidate as
  `scripts/art/sources/campfire-sitters/<visual>.webp`, record its `seat`, `crown` and provenance in that folder's
  `manifest.json`, then run `python3 scripts/art/campfire-sitters.py export`. `verify-assets.mjs` requires a
  sprite for every visual id; the runtime seats any party from those sprites, so no per-party art exists.
- [ ] `scripts/verify-assets.mjs`: `MENU_ART_MANIFESTS` (the skin's menu-art provenance manifest). It is asserted
  complete, so registration fails until the entry exists. Merchant figures need a floor offset line in
  `src/ui/chrome/merchant-arrival.css` (checked against the image's bottom margin). A staged skin's bake and its
  attack manifest (`generated` entries: prompt, source and output hashes) are checked by `scripts/verify-art-bakes.mjs`;
  the bake scripts (`monogatari*.py --check`) must pass.
- [ ] Attack animation, one of two kinds. **Staged** (Kratos, Silent-chan, Watcher-chan): set the `stagedAttack` trait,
  write `scripts/animation/skins/<skin>.json` and run `python3 scripts/animation/skin-attack.py`. One generic
  implementation plays it (`docs/skins/attack-animation.md`); no code or class names the skin, and
  `scripts/animation/audit-poses.py` (run by `verify-art-bakes.mjs`) holds every drawing of Silent-chan and Watcher-chan to the idle's head and prop scale
  (Kratos is excluded: it has no `audit` landmarks, and `kratos.py --check` measures its pose shifts and reach instead).
  **Pose pair** (Ironclad-chan, Defect-chan): no `stagedAttack` trait; the hero's own attack clock, travel and hit logic
  play, and `CombatScreen.tsx` (`isMonogatariVisual`, `MonogatariAttackPose`) steps two complete drawings
  (`<skin>-ready/impact` or `-charge/release`) over the hero's rig. A skin with neither keeps the hero's own attack.
  Code that depends on the hero (the Wrath/Calm aura, the energy pip's colours, the Defect's orb VFX) must test the
  *character*, never the visual id; the visual id only chooses art.

Picked up automatically from `SKINS`/`VISUAL_IDS`: the campfire seating (`src/ui/CampfireScene.tsx`), the Shop's offer
tiles and the locked racks for heroes without a skin (none today), Profile's rows,
the staged attack's CSS and table, the energy orb, and the inventories and cases of `verify-assets.mjs`,
`verify-ui-helpers.mjs`, `verify-skins.mjs`, `verify-skin-browser.mjs`, `verify-skin-cards-browser.mjs`,
`verify-treasure-animation-browser.mjs`, `verify-merchant-overflow-browser.mjs`, `verify-skin-attack-browser.mjs`
and `check-single-player-build.mjs`. Registering a skin extends all of them; each fails loudly until the
skin's art exists.

## The final registration step (art exists first)

1. Art in place per section 2 (including `animated/<skin>-*.webp`, `sfx/*.mp3`, hit VFX, the campfire sprite).
2. `src/game/skins.ts`: `SKINS`, `SKIN_LABELS`, `SKIN_TRAITS`; `src/game/coins.ts`: `SKIN_PRICES`.
3. `skin-attack.py --measure <skin> --write` (Silent-chan's and Watcher-chan's bake scripts, `monogatari_silent.py` and
   `monogatari_watcher.py`, plant the drawings themselves, so their `poseShift` stays empty and `--measure` is read-only
   for them), then `skin-attack.py` (CSS and table); `sync-skin-card-faces.mjs`;
   `campfire-sitters.py export`; `hero-art-head.json`; `MENU_ART_MANIFESTS`.
4. `ATTACK_CARDS` in `verify-skin-attack-browser.mjs` names each character's attack cards (Ironclad, Silent and
   Watcher exist); a hero with a second skin (Ironclad) is seated in a second round of the treasure and merchant verifiers.
5. `npx tsc -b`, `verify-architecture`, `verify-assets`, `verify-art-bakes`, `verify-skins`, `verify-ui-helpers`, then the browser
   verifiers of section 4. Docs: `docs/skins/<skin>-*`, `ATTRIBUTION.md`.

## 2. Art every skin must ship

| # | What | Path pattern | Size / format |
|---|------|--------------|---------------|
| 1 | Card art for every card the hero can own: starter deck, every reward-pool card, and every purchasable pack card of that hero (Slayer Pack) | `skin-card-art/<skin>/<owner>/<cardId>.webp` (text-free art), `skin-cards/<skin>/<assetKey>.webp` (full face), `skin-cards-sm/<skin>/<assetKey>.webp` (448 px face), base **and** upgraded (`+`) | art 748×420 ≤ 40 KiB; faces keep the hero's own scan size; WebP |
| 2 | Combat idle sprite | `combat/characters/<skin>-hero.webp`, `combat/characters/<skin>.webp` (list/summary icon) | 1152×1152 and 512×512, native alpha |
| 3 | Attack animation (timed poses, hit logic stays the hero's) | `combat/characters/animated/<skin>-<pose>.webp` (`-ready` is the rest drawing), `animated/<skin>-idle.webp` (idle loop), `scripts/animation/skins/<skin>.json`; timing is generated into `staged-attacks.css` and `staged-attacks.ts` | one drawing per pose, one square canvas, ground anchor; 4-6 poses for a short strike (`docs/skins/attack-animation.md`) |
| 4 | Attack VFX | `combat/vfx/actions/<skin>/{light,impact}.webp` | 512×512, native alpha |
| 5 | Attack sounds | `sfx/<name>.mp3` for every sound in the config (cues synchronised to the animation beats) | decodable mp3, volumes in the config's `sounds` |
| 6 | Energy orb (enable the `energyOrb` trait) | `combat/energy-orbs/<skin>.webp` | 256×256, native alpha |
| 7 | Treasure hand model (open hand and gripping hand) | `noncombat/treasure/hand-<skin>.webp`, `noncombat/treasure/grip-<skin>.webp` | 384×1024, native alpha |
| 8 | Merchant standing figure | `noncombat/merchant/characters/<skin>-standing.webp` | 400×576, native alpha |
| 9 | Campfire sprite: the hero seated on an invisible seat facing right, on transparency, placed on the shared sprite canvas by `scripts/art/campfire-sitters.py export`. See `docs/skins/campfire-scenes.md`. | `noncombat/campfire/sitters/<skin>.webp` | 1408×1808 WebP, native alpha, hips at (704, 848) |
| 10 | Character-select portrait and wallpaper | `menu/character-select/portrait-<skin>.png`, `menu/character-select/character-<skin>-wallpaper.webp` | 256×384 and 1536×864 |
| 11 | Profile tile | uses the portrait (10); no extra file | |

Not skinned on purpose: the hero's compendium/stats/leaderboard icon
(`menu/compendium-icons/<character>.webp`), the run summary damage chart icon (hero icon), the hero's relic, powers and power icons,
cursed/status art, enemy art.

## 3. Things that are easy to miss

- Head calibration for hero potions (`hero-art-head.json`, `scripts/calibrate-hero-head.py`).
- Reduced-motion static art for the attack animation, and cold-play fallback to the idle drawing.
- The Gem-socketed card faces (`cards-socketed-sm/`) are not skinned: a card with an attached
  Gem shows the default face.
- Every new card the hero gains later needs skin art too; `verify-assets.mjs` fails until the
  face and art exist (or the card is explicitly listed as pending).
- Both screen classes: desktop and horizontal phone. Check the idle, attack, hand, treasure,
  merchant, campfire, select screen and Profile tile on both.
- Pages size budget: `dist` must stay under the Pages cap (the `du -sb dist` test in `.github/workflows/pages-deploy.yml`,
  asserted by `scripts/verify-pages-deploy.mjs`; `scripts/check-single-player-build.mjs` only checks the build's contents);
  large attack art is served through the CDN rules in `src/game/assets.ts`.
- Provenance: record model, references, prompts and SHA-256 under `docs/skins/<skin>-*/`
  (see `docs/skins/kratos-card-art/README.md`) and add third-party reference credits to
  `ATTRIBUTION.md`.
- Availability: skins are bought, then worn from Profile or the Shop. See section 5.

## 4. Tests

Most of these iterate `SKINS` already, so registering a skin extends them; they fail loudly until the art exists.

- `scripts/verify-skins.mjs` (registry, pairs, `visualId`, runs/rooms carry a valid skin only).
- `scripts/verify-assets.mjs` (inventories for every path above, dimensions, alpha, generated tables, menu-art and
  Ironclad-chan/Defect-chan provenance hashes).
- `scripts/verify-art-bakes.mjs` (attack and card-art provenance hashes, re-run bakes and pose audits, frame and pixel audits; slow, so
  `verify-all --changed` selects it only when an art pipeline input changes).
- `scripts/verify-skin-browser.mjs`, `verify-skin-cards-browser.mjs`, `verify-skin-profile-browser.mjs`
  (what a skinned hero shows in solo and in an online room; the Profile picker).
- `scripts/verify-skin-attack-browser.mjs` (timing, contact line, planted feet, reduced motion) for every skin with
  a staged attack, plus two synthetic test skins (`scripts/animation/test-skins/`) that cover the generic path on
  desktop and horizontal phone in Chromium and WebKit.
- Treasure, merchant, campfire and art-scene browser verifiers (`verify-treasure-animation-browser.mjs`,
  `verify-merchant-overflow-browser.mjs`, `verify-art-scenes-browser.mjs`).
- `scripts/lib/test-skins.mjs`: a Vite plugin that registers synthetic skins into the real app for a verifier
  (more skins than the catalogue has, such as a second Silent skin; `verify-test-skins-browser.mjs`), so layouts can be
  checked before art exists. Shop and Profile verifiers run against the real skins.
- `scripts/verify-pipeline.mjs` and `scripts/lib/affected-verifiers.mjs`: list new verifiers under
  the files that own the behavior (a duplicate owner entry throws).

## 5. Purchase and ownership (every skin is for sale)

Every skin costs coins from the account's wallet (docs/shop.md). Adding a skin needs:

- [ ] `src/game/coins.ts`: a price in `SKIN_PRICES` (`Record<SkinId, number>`, so `tsc -b` fails
  until it exists; 2,500 = `SKIN_PRICE` for all five skins).
- [ ] Nothing else lists it: the Shop's Skins tab (`ShopScreen.tsx`), Profile's locked and owned
  tiles, the wallet (`skins`, `buySkin`), and the server (`syncAccountWallet`) all derive from
  `SKINS` and `SKIN_PRICES`.
- [ ] Ownership gating: `src/skin-preference.ts` only reads back skins the wallet owns
  (`preferredSkin`, `savedSkinChoices`), so character select, solo and online starts, Profile
  and `skin-context.tsx` never show an unowned skin. New code must read the worn skin through
  those functions, never from `localStorage` or a run it did not start.
- [ ] Browser fixtures that wear the skin through the preference must give the account's wallet
  `skins: ['<skin>']` (`sts-wallet:<username>`); runs built from a fixture that already carries
  `skin` need nothing.
- [ ] Extend `verify-shop-browser.mjs` (buy, refusal, owned and Wear/Worn, locked racks, short
  windows), `verify-skin-profile-browser.mjs` (locked tile with price opens the Shop, owned tile
  selectable, unowned choice ignored), `verify-wallet.mjs`, `verify-account-wallets.mjs` and
  `verify-wallet-sync-browser.mjs` for anything price- or ownership-specific.
