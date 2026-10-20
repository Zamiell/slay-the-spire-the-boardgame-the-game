# Skin requirements

A skin changes how one hero looks and sounds, never how it plays. Rules, RNG, saves and
hashes never read a skin. Six skins ship, one or more for every base hero and one for Slime Boss: Kratos (Ironclad's, id `kratos`),
Ironclad-chan (`monogatari_ironclad`), Silent-chan (`monogatari_silent`), Defect-chan (`monogatari_defect`),
Watcher-chan (`monogatari_watcher`) and Rimuru Tempest (`anime_slime_boss`, Slime Boss's), the four "-chan" skins before her drawn in
the style of the Monogatari anime series. Rimuru Tempest is the first skin of a Downfall hero: a fan illustration named after
Rimuru Tempest (*That Time I Got Reincarnated as a Slime*), the human form of Slime Boss, drawn from the user's own reference
image. Kratos, Silent-chan, Watcher-chan and Rimuru Tempest are the references for a skin with a staged attack
(below); Ironclad-chan and Defect-chan
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
  the bake scripts (`monogatari*.py --check`, `anime_slime_boss.py --check`) must pass.
- [ ] Attack animation, one of two kinds. **Staged** (Kratos, Silent-chan, Watcher-chan, Rimuru Tempest): set the `stagedAttack` trait,
  write `scripts/animation/skins/<skin>.json` and run `python3 scripts/animation/skin-attack.py`. One generic
  implementation plays it (`docs/skins/attack-animation.md`); no code or class names the skin, and
  `scripts/animation/audit-poses.py` (run by `verify-art-bakes.mjs`) holds every drawing of Silent-chan, Watcher-chan and Rimuru Tempest to the idle's head and prop scale
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
3. `skin-attack.py --measure <skin> --write` (Silent-chan's, Watcher-chan's and Rimuru Tempest's bake scripts, `monogatari_silent.py`,
   `monogatari_watcher.py` and `anime_slime_boss.py`, plant the drawings themselves, so their `poseShift` stays empty and `--measure` is read-only
   for them), then `skin-attack.py` (CSS and table); `sync-skin-card-faces.mjs`;
   `campfire-sitters.py export`; `hero-art-head.json`; `MENU_ART_MANIFESTS`.
4. `ATTACK_CARDS` in `verify-skin-attack-browser.mjs` names each character's attack cards (Ironclad, Silent, Watcher
   and Slime Boss exist: Strike and Flame Tackle with its Command); a hero with a second skin (Ironclad) is seated in a second round of the treasure and merchant verifiers.
5. `npx tsc -b`, `verify-architecture`, `verify-assets`, `verify-art-bakes`, `verify-skins`, `verify-ui-helpers`, then the browser
   verifiers of section 4. Docs: `docs/skins/<skin>-*`, `ATTRIBUTION.md`.

## 2. Art every skin must ship

| # | What | Path pattern | Size / format |
|---|------|--------------|---------------|
| 1 | Card art for every card the hero can own: starter deck, every reward-pool card, and every purchasable pack card of that hero (Slayer Pack) | `skin-card-art/<skin>/<owner>/<cardId>.webp` (text-free art), `skin-cards/<skin>/<assetKey>.webp` (full face), `skin-cards-sm/<skin>/<assetKey>.webp` (448 px face), base **and** upgraded (`+`) | art 748×420 ≤ 40 KiB; faces keep the hero's own scan size; WebP |
| 2 | Combat idle sprite | `combat/characters/<skin>-hero.webp`, `combat/characters/<skin>.webp` (list/summary icon) | 1152×1152 and 512×512, native alpha |
| 2a | Summon drawing, only for a skin of Slime Boss (optional: without it the idle drawing shows) | `combat/characters/<skin>-spawn.webp` | One complete drawing on the 1152×1152 canvas of `<skin>-hero.webp`, native alpha, framed exactly like it (same ground line, stature and centre line; `verify-assets.mjs` fails otherwise); `src/ui/hero-art-head.json` needs its `<skin>-spawn` head entry |
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

- A skin of a Downfall hero (Slime Boss is the first; see section 6 for how these heroes differ from the base heroes): hero-dependent code reads the *character*, never the visual id. The
  Slime formation (`.slime-party`, `data-slime-formation`) follows `occupant.character === 'slime_boss'`; the skin must be
  `stagedAttack` (a skinned hero has no rig, so its idle is `animated/<skin>-idle.webp`); the skin's `energyOrb` replaces the
  Downfall orb layers (`CombatScreen.tsx`); while a Slime card resolves the seat shows `<skin>-spawn.webp` (row 2a), falling back to
  `<skin>-hero.webp`, for the same window the plain hero's 16-frame spawn plays; the Slime Command's own damage is never part of the
  hero's staged strike (`resolveSlimeCommand` keeps it off the card event's `enemyHpLoss`). Downfall CSS faces paint no illustration
  (`CardFace.tsx`), so `skin-card-art` for such a hero is only a provenance and fallback inventory, never shown today. The `slime`
  creature cards keep the default face (`UNSKINNED_CARD_TYPES` in `verify-assets.mjs`).
- Six skin racks side by side on a small desktop window leave less than a price button's width: `shop.css` tightens the name and the
  price inside a rack narrower than 7.2rem (a container query); `verify-shop-browser.mjs --skins=all` proves every window size.

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
  until it exists; 2,500 = `SKIN_PRICE` for all six skins).
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

## 6. Skins of a Downfall hero

The registration steps above were written for the base heroes (Ironclad, Silent, Defect, Watcher). The Downfall heroes
(`DOWNFALL_CHARACTER_IDS` in `src/game/types.ts`: `slime_boss`, `guardian`, `hexaghost`, `hermit`) keep their rules, cards and art in
different places, so a skin of one needs the extra care below. Slime Boss (Rimuru Tempest, `anime_slime_boss`) is the only one so
far; its commit is the worked example.

| What | Base hero | Downfall hero |
|---|---|---|
| Card definitions | `CARDS` in `src/game/cards.ts` | `src/game/downfall/<hero>.ts`. Guardian, Hexaghost and Hermit are imported by `cards.ts`. `slime-boss.ts` registers itself with `registerCardDefinitions` and is imported by `state.ts`, `acquisition.ts` and `run/setup.ts`, not by `cards.ts`, so a script that imports `cards.ts` alone sees no Slime Boss card (`dump-cards.mjs` imports the module on purpose) |
| Starter deck and rewards | `STARTER_DECKS` lists card ids and `characterRewardDeck` reads `CARDS` by owner | Slime Boss, Guardian and Hermit build their decks in their own module (`SLIME_BOSS_STARTER_DECK`, `GUARDIAN_PHYSICAL_DECKS`, `HERMIT_PHYSICAL_DECKS`; `slime-boss.ts` assigns `STARTER_DECKS.slime_boss` when it loads, and `characterRewardDeck` special-cases these three). Hexaghost uses the shared paths like a base hero |
| Card faces | `Card` shows the card's scan; a worn skin shows its composited face from `skin-cards*` | the same: a skin's composited scan is what players see. Only the CSS fallback face (`CardFace.tsx`, used when a card has no scan) paints no illustration for Downfall cards, so `skin-card-art/<skin>/` is a provenance and fallback inventory, never shown today. Scan names come from `cardAssetKey`/`tierOf` in `src/game/assets.ts` (`slime_boss__normal__goop-armor`, a filing tier, not the physical deck name), and `sync-downfall-card-assets.mjs` syncs them |
| Combat art | one rig entry per hero (`hero-<id>` in `scripts/animation/rigs.json`) | the hero's rig entry (Hexaghost has none: its seven `hero-hexaghost-heat-0..6` rigs replace it) plus hero-specific states: Slime Boss `slime_boss-spawn.webp` (16 frames) and a six-layer Energy orb (`combat/energy-orbs/slime_boss/layer1-6`; Guardian has seven), Guardian's defense stance (`guardian-defense`) and Hexaghost's heat stages (`hexaghost-heat-0..6`). `CombatScreen.tsx` hard-codes those state rig ids (and their head calibration in `hero-art-head.json`), and Guardian's stance portrait requires the unskinned visual id, while a staged skin overrides the idle and attack images. Guardian's turn-start mode chooser also loads `guardian.webp` and `guardian-defense.webp` directly, so it keeps showing the original Guardian. Art for such a state is therefore unused until the renderer and the head lookup are made skin-aware, so a skin of Guardian or Hexaghost needs code changes, not just more drawings |
| Skin verifiers | `CORE_HEROES` and `BASE_CHARACTER_IDS` in the skin verifiers list only the four base heroes, and a base hero is the "other" hero of a fixture | the generic `CORE_HEROES` partner selection never picks a Downfall hero (some verifiers still seat one on purpose, such as `verify-skins.mjs` pairing a skinned Slime Boss with Guardian); its own skin is found through `characterOfSkin`, and `ATTACK_CARDS` in `verify-skin-attack-browser.mjs` needs that hero's attack cards. `verify-ui-helpers.mjs` enumerates every skin and builds `strike_<hero>`/`defend_<hero>` card ids, special-casing only Slime Boss: Guardian and Hermit name theirs `<hero>_strike`/`<hero>_defend`, so both the expectation and the id rule need updating. `verify-skin-cards-browser.mjs` builds a fixture deck of the starter cards plus a curse, a partner card, and a Slayer Pack and a `slime` card only where the hero has them, then waits for `starterSize + 3` cards in the deck viewer: for Guardian, Hexaghost and Hermit the count must come from the fixture, not the constant. `verify-skin-profile-browser.mjs` lists heroes and skins explicitly (`ROW_IDS`, `ALL_DEFAULT`, `OWNS_ALL`), and the first skin of Guardian, Hexaghost or Hermit adds a Profile row that those lists must name |
| Shop | a base hero without a skin gets a locked "Coming soon" rack (`LOCKED_HEROES` is `BASE_CHARACTER_IDS` without a skin) | no locked rack: Guardian, Hexaghost and Hermit have none today; a skin adds a rack through `SKINS`, but `HERO_ACCENT` in `ShopScreen.tsx` has an entry only for Slime Boss among them: the first skin of any other Downfall hero needs its accent added, or the rack falls back to Colorless grey |

Steps that differ from section 1:

- **Card pipeline owner.** `SKIN_OWNERS` (`scripts/art/skin-cards/skincards.py`) maps a skin id to its hero. `build_masks.py --owner`
  lists its allowed owners (today ironclad, silent, watcher and slime_boss), so a new hero has to be added there, and
  `registration_file()` in `skincards.py` routes scan keys by prefix: add the hero's prefix and its own registration file next to
  `defect-registration.json` and `slime-boss-registration.json`, otherwise the keys fall into the shared `registration.json`, whose
  hash the Ironclad-chan manifest records, and `verify-art-bakes.mjs` fails. Run `dump-cards.mjs <hero>` for the catalogue.
- **Cards that need a policy.** `dump-cards.mjs` keeps attack, skill and power cards only. `verify-assets.mjs` still wants a face for every
  card of the hero unless `UNSKINNED_CARD_TYPES` exempts its type (Slime Boss's `slime` creature cards). Hermit's curse-type cards
  (Scorn, Horror, Fatal Desire and others) must be either exempted deliberately or supported by the pipeline, which today has no `curse` case: the mask builder picks references only for attack, skill and power cards and `WINDOW_BOX` in `skincards.py` has no `curse` window.
  Guardian's Gems, Guardian's Golden Ticket and Hermit's Golden Ticket have no upgraded scan, while the mask builder, `composite.py` and
  `verify-assets.mjs` all ask for both faces (Guardian's are typed `attack`, so the catalogue includes them): they need pipeline support or
  a selective exemption (an `attack` entry in `UNSKINNED_CARD_TYPES` would exempt every ordinary attack too).
- **Hero-dependent code.** The Slime formation follows `occupant.character`, the footer's Energy orb layers follow the viewing player's character (`downfallCharacter`, which matters in multiplayer); the staged-attack lifetime follows
  the skin's `stagedAttack` trait through `hasStagedAttack(playerVisualId(player))`. Check the same split for the hero's own special
  state. Hermit's volley is handled before the skin is consulted (`HERMIT_VOLLEYS` weights in `combat-screen/vfx.tsx`, its duration in
  `combat-screen/hooks.ts`), so a Hermit skin has to reconcile that clock with its staged one rather than copy Slime Boss's setup. The volley's bullets are not inherited either: `hermitEvent` requires `occupantVisual === 'hermit'`, staged poses bypass that component, and the muzzle coordinates in `vfx.tsx` are tied to Hermit's own rig, so keeping the bullets means making that path skin-aware and recalibrating it, and dropping them for staged impacts is an explicit choice. Hexaghost's flame projectiles have the same gate (`occupantVisual === 'hexaghost'` in `CombatScreen.tsx`), so a Hexaghost skin must either make that path skin-aware or replace the flames with staged impacts on purpose.
- **Energy orb.** A skin with the `energyOrb` trait also needs its glow colour: a rule in `src/ui/styles/damage-reactions.css` and an
  `ORB_GLOW` entry in `verify-skin-browser.mjs`; registration does not add either.
- **Merchant standing figure.** The merchant arrival equalises every standing figure's painted height (`--standing-scale` in
  `src/ui/chrome/merchant-arrival.css`), so the new figure needs a scale and a floor `translateY` computed from its own painted rows,
  as the existing lines are.
- **Pages budget.** Six skins leave about 17 MB of `dist` headroom (`docs/skins/README.md`): check the build before art generation, not after.
