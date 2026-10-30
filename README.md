# Slay the Spire — The Board Game

An unofficial digital implementation of Contention Games' *Slay the Spire: The Board Game*.
See [ATTRIBUTION.md](ATTRIBUTION.md) for the provenance of the limited bundled artwork.

## Quick start

```bash
pnpm install
pnpm dev             # start the client and API; play at http://localhost:5180
```

The API/room server runs on `127.0.0.1:8787` and is required for accounts, even in
single player. Local accounts and room data are saved in `.rooms/rooms.json`.
`pnpm play` starts the same services. To run them in separate terminals, use
`pnpm dev:client` and `pnpm dev:rooms`.

Choose **Single Player** for a one-character run. The app handles setup, the shared die,
enemy turns, rewards, rooms, campaign progress, and Acts II–IV. Click a card and then its
target to play it.

For 2–4 friends, choose **Multiplayer**, share the room code, and play from one browser per
person. For the always-on authoritative room server and voice chat setup, see
[`docs/online-play.md`](docs/online-play.md).

## Developer console

Press the backtick key (`) during a local run to open the console; press it again
or Escape to close. Type `help` for usage, use Tab to complete commands and IDs,
and Up/Down to recall commands. Names are case-insensitive; quoted names also work.

The STS2-style commands are `gold`, `heal`, `energy`, `block`, `draw`, `card`,
`remove_card`, `upgrade`, `relic`, `potion`, `power`, `damage`, `kill`, `win`, and
`die`. For example: `gold 10`, `card BASH+`, `relic VAJRA`, `potion ENERGY_POTION`,
or `power STRENGTH 3`. Use `list cards bash`, `list relics`, or `status` to find
IDs and targets. Target 0 is your character; enemies start at 1. Card positions
start at 0. Commands use this adaptation's cards and board-game limits, not STS2's
content or numeric balance.

Using a state-changing command permanently makes the run **unranked**, including
after saving/resuming: no leaderboard submission, account Coins, or campaign
progress. Opening the console, reading help, and invalid commands do not change
the run. Multiplayer, tutorials, and replays do not expose this console.
STS2-specific navigation, unlocks, achievements, and godmode are not implemented.

## Assets

The repository includes optimized card, relic, and potion scans; original generated combat art
for the four characters, all 61 canonical enemy designs and stages; and 251 text-free
character-card illustrations. Every asset needed to play, including the optimized rulebook icons,
is included in a fresh clone. Eleven optional Act I reference crops are fetched by `pnpm sync:assets`.

| Group | Source | Needs |
| --- | --- | --- |
| Native character-card illustrations | original OpenAI Imagegen illustrations | committed WebP files |
| Card, relic and potion scans | a third-party card browser | committed WebP files |
| Keyword and token icons | the official rulebook PDF | committed transparent PNG files; PDF, PyMuPDF, and Pillow to refresh |
| Enemy reference crops | enemy card scans in the same PDF | optional local sync only |
| Combat stage and cutouts | original OpenAI Imagegen illustrations | 61 committed enemy WebP files |
| Combat status and Power pictograms | original OpenAI Imagegen illustrations | committed transparent PNG files |
| Title-menu and compendium backgrounds | original OpenAI Imagegen illustrations | committed WebP files |
| Kreon UI typeface | Google Fonts / Kreon Project Authors, SIL OFL 1.1 | committed TTF and license |

```bash
brew install ffmpeg webp          # cwebp ships in the webp formula
pip install pymupdf pillow
mkdir -p docs/reference
curl -L https://contentiongames.com/_images/STS_KS_Rulebook.pdf \
  -o docs/reference/STS_KS_Rulebook.pdf
```

On Debian or Ubuntu: `apt install ffmpeg webp`. Each sync script checks for what it
needs and tells you what is missing rather than failing halfway through.

Run `pnpm sync:assets` only to refresh the bundled scans and official HUD symbols or add the
eleven optional local Act I reference crops described in [ATTRIBUTION.md](ATTRIBUTION.md).

## Layout

| Path | What lives there |
| --- | --- |
| `src/game/` | Pure, deterministic rules engine. No React, no DOM, no `Math.random`. |
| `src/ui/` | React client. |
| `scripts/` | `verify-*.mjs` checks and the `sync-*.mjs` asset pipeline. |
| `docs/` | Rules reference and design decisions. |
| `data/` | Card index plus community-sourced manifests of cards, items and enemies. |

## Verification

The asset verifier requires Python 3 and Pillow for pixel-level transparency checks.

```bash
pnpm verify              # every scripts/verify-*.mjs, headless
pnpm verify:changed      # only checks affected by uncommitted files (vs HEAD)
node scripts/verify-all.mjs --changed=origin/master  # affected branch checks since a base ref
pnpm verify:browser      # drives the real app in Chromium, writes screenshots
node scripts/verify-rng.mjs   # or run one directly
```

`verify:browser` clicks real cards and asserts against engine state read through a debug
bridge, not against pixels. Screenshots land in `artifacts/browser/` for review, and the
run fails on any console error, page error or failed request.

`verify-all.mjs` runs browser suites one at a time locally because each boots its own Vite
and browser. Browser checks are opt-in local tools; CI runs the production build and affected
non-browser checks.

There is no test framework. Each check is a plain Node program that imports the engine
directly (Node 24 strips TypeScript types on import) and exits non-zero on failure. This
keeps the engine importable from playtests, the server, and the browser without a build
step — at the cost of requiring **erasable-only TypeScript** in `src/`: no `enum`, no
`namespace`, no constructor parameter properties.

## Determinism

Every random decision routes through the seeded RNG in `src/game/rng.ts`. A game is fully
described by `(seed, action log)`, which is what makes server-authoritative multiplayer,
reconnection, and reproducible playtests all work off the same machinery.

## Implemented scope

A run climbs a generated Spire map, fights through encounters, elites and a boss, and
carries HP, gold and relics between rooms. Combat covers the full round: energy, draw,
the shared die, card play with targeting and choices, orbs, stances, Scry, statuses, and
the enemy turn.

The current scope is summarized at the top of [`src/game/state.ts`](src/game/state.ts).
Executable inventory checks in [`scripts/verify-architecture.mjs`](scripts/verify-architecture.mjs)
keep its counts aligned with the physical component manifests and fail if a printed character
card is missing or the deferred-card list disagrees with the implementation.
