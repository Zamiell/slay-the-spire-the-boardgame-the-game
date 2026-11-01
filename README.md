# Slay the Spire — The Board Game

An unofficial digital implementation of Contention Games' *Slay the Spire: The Board Game*.
See [ATTRIBUTION.md](ATTRIBUTION.md) for the provenance of the limited bundled artwork.

## Quick start

```bash
pnpm install
pnpm dev             # start the client, API, and assistant listener; play at http://localhost:5180
```

The API/room server runs on `127.0.0.1:8787` and is required for accounts, even in
single player. Local accounts and room data are saved in `.rooms/rooms.json`.
`pnpm play` starts the same services. To run them in separate terminals, use
`pnpm dev:client`, `pnpm dev:rooms`, and `pnpm dev:assistant`.
The assistant listener is local and read-only; it receives no game state until
you opt in through **Settings > Assistant** using the pairing code printed in the
development terminal. Ctrl+C stops the services. See [`docs/live-run.md`](docs/live-run.md).

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

`rewind` restores the recorded start of the **previous** turn in the current
fight, including hands, enemies, resources, RNG, and any start-of-turn choices.
It cannot cross fights or rewind turn 1, and reports an error if history is
unavailable. Repeated uses step backward through earlier turns; the restored
state is saved for Resume.

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

These commands cover optional scan extraction, not byte-exact animation rebakes.
The artwork audit toolchain below must be used for committed generated artwork.

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

The asset verifier requires Python, Pillow, NumPy, WebP, and FFmpeg. Byte-exact
animation checks additionally require the compatible versions recorded in
`infra/art-toolchain.json`; arbitrary pip wheels may bundle a different WebP codec.

```bash
node scripts/art-audit.mjs --check-toolchain
node scripts/art-audit.mjs --container                    # rootless Podman
node scripts/art-audit.mjs --container --runtime=docker   # Docker alternative
```

The container uses an immutable Ubuntu image and dated Ubuntu package snapshot.
It runs the six image/media audit suites with the checkout mounted read-only and
network access disabled. Run `pnpm install --frozen-lockfile` first: the mounted
checkout supplies the Node dependencies. The canonical image targets Linux AMD64;
other architectures need container emulation. No repository sources or artwork
are uploaded or included in the image.

The built image can also run the existing Python bake commands documented in
`scripts/animation/README.md`. For an intentional rebake, mount the checkout
writable when invoking that image directly; the audit wrapper deliberately does
not offer a writable mode.

On an Ubuntu 26.04 audit machine, the native equivalent used by CI is:

```bash
snapshot=$(node -p "require('./infra/art-toolchain.json').aptSnapshot")
sudo apt-get update --snapshot "$snapshot"
sudo apt-get install -y --no-install-recommends --snapshot "$snapshot" ffmpeg python3-numpy python3-pil webp
node scripts/art-audit.mjs --check-toolchain
pnpm verify:art
```

If preflight reports a mismatch, use the container rather than regenerating
committed assets with different codecs. Updating the toolchain is an intentional
change: update the manifest, verify byte-exact output, and review any necessary
asset changes separately.

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

Suite ownership, lanes, and output/resource requirements are declared in
`scripts/lib/verifier-registry.mjs`. Dependency inference remains the fallback for
unregistered checks. Managed Playwright recordings and screenshots live under
`artifacts/verification/browser/<suite>/<run>/`; separate invocations retain their
evidence. Legacy suites keep their explicitly owned artifact directories.
`verify-build.mjs` builds into a fresh private directory and removes it afterward;
use `pnpm build` to create the production `dist` used by preview and deployment.

Engine and server checks are plain Node programs that import the engine directly.
Compatible browser suites use Playwright Test through the shared silent fixtures,
with standalone `verify-*-browser.mjs` entrypoints retained. Node 24 strips
TypeScript types on import, and checks exit non-zero on failure. This
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
