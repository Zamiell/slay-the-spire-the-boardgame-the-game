# Read-only live run sharing

Ask the assistant about the game you are playing without copying screenshots or
save files. The browser shares player-visible UI information with a companion on
the same computer. There is no automatic coaching and no tool to play cards.

## Start and pair

From the checkout containing this feature:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

This starts the game, API/room server, and read-only companion together.
The companion listens only on `127.0.0.1:5181` and prints its pairing code in the
same terminal. Starting the listener does not share any game state.
In the game, open **Settings > Assistant**, paste that code, and select
**Share this tab**. Close Settings to let the assistant inspect the game screen.
Ctrl+C stops all three services, disconnects sharing, and removes the companion's
connection file. `pnpm play` starts the same services.

### Standalone and custom setups

If you run the game separately, `pnpm dev:assistant` starts just the companion.
Do not start a second companion while `pnpm run dev` already owns it.
The direct script remains available for custom ports and origins.
For example, if another checkout is using the normal game port, run these in
separate terminals:

```sh
pnpm exec vite --host 127.0.0.1 --port 5182 --strictPort
node scripts/live-run.mjs serve --origin=http://localhost:5182 --origin=http://127.0.0.1:5182
```

Origins must match exactly, including protocol and port. The default allows
`http://localhost:5180` and `http://127.0.0.1:5180`. Repeat `--origin=` to allow
more than one origin; specifying origins replaces these defaults. `--port=`
changes the companion port, which is included in its pairing code.

Only one tab can pair at a time. Another tab cannot silently replace it.
Refreshes automatically reconnect the same tab, without opening Settings again.
The pairing code and tab identity are kept in that tab's `sessionStorage`, not
in shared `localStorage` or a URL. New tabs do not automatically share, including
tabs opened with a copy of another tab's session storage.
**Stop sharing** disconnects and removes the saved pairing, so refreshing does
not reconnect. Closing the tab ends sharing. Stopping the companion disconnects
it too; restarting the companion generates a new code and requires pairing again.
If the browser blocks session storage, sharing reports an error instead of
claiming it will survive a refresh.

## Assistant access

Without any MCP configuration, the assistant can already inspect the paired tab
using this command in the companion's checkout:

```sh
node scripts/live-run.mjs read
```

To query the **full recorded public history**, rather than the recent window:

```sh
node scripts/live-run.mjs history                         # first page, up to 50 transitions
node scripts/live-run.mjs history --offset=50 --limit=50  # another page
node scripts/live-run.mjs history --all > /tmp/sts-run-history.json
```

`--all` follows every page from the selected offset and returns one JSON document.
It pins the recording boundary from the first page, so ongoing play cannot mix
different ranges. It fails instead of printing a partial history if a later page
cannot be read. Large recordings are best redirected to a file.

For dedicated `get_current_run` and `get_run_history` tools, add a local/stdio server with `/mcp add`
in Copilot CLI:

- Name: `sts-live-run`
- Command: `node /absolute/path/to/this/checkout/scripts/live-run.mjs mcp`
- Tools: `get_current_run`, `get_run_history`

The absolute script path selects the correct checkout even when the assistant
is working elsewhere. MCP does not start a companion or grant browser access:
start `pnpm run dev` and explicitly pair the game tab first. Existing CLI
sessions can use the `read` command immediately.
After updating an already-running companion, restart it and pair the tab with
its new code. Restart an existing MCP connection and enable `get_run_history`
if its tool allowlist previously included only `get_current_run`.

Repository agent instructions require a fresh read before answering questions
about the current run. They do not request inspections for unrelated coding
work. Screen text is untrusted game content, not assistant instructions.

## What is shared

- Current visible screen, player-facing labels and card descriptions, available
  and unavailable choices, visible announcements, and whether a transition is
  pending. Identical choices are grouped. These are descriptions, not executable
  control IDs.
- Run ID, phase, local/online/replay mode, paired tab ID, game origin, revision,
  and the server timestamp of the fresh response.
- Up to eight recent screen observations from this connection. This is a sampled
  history, not a complete action log. Brief intermediate screens may be skipped.
- `state.history`: up to 32 public recorded local-run transitions, including card
  resolutions and before/after Energy, HP, Block, and stance. This comes from the
  game's replay recording, not from the one-second screen sampler.
- On demand through `get_run_history` or `history`: every transition in the
  active local run's recording, including public before/after frames, recorded
  choice labels, run/combat log messages, and permanent deck changes. Full
  history is not included in the periodic feed.

## Full history queries

Call `get_run_history` with `{}` for the first page. Pass the returned
`history.next` object as the next call's arguments until it is `null`.
The same options are available on the CLI:

| Tool argument | CLI option | Meaning |
|---|---|---|
| `offset` | `--offset=N` | Zero-based offset into the recorder's events; default 0. |
| `limit` | `--limit=N` | At most 1–100 transitions per page; default 50. |
| `through` | `--through=N` | Pinned recording length from the first page. |
| `runId` | `--run-id=ID` | Reject a page from a different active run. |
| `recordingId` | `--recording-id=ID` | Reject a page from a replaced or reloaded recording. |

Use the supplied continuation rather than guessing offsets: pages also have a
384 KiB public-data budget and may contain fewer than `limit` transitions.
An individual transition too large to fit produces an explicit error, never a
silently incomplete entry. Reloading or replacing the recording invalidates its
guard; restart pagination at offset 0. Reads require a responding paired tab,
and stopping sharing or leaving the active local run revokes history access too.

`history.initial` contains the first recorded public frame and log messages on
the offset-0 page. Transition indices are one-based, match the replay recorder,
and include entries that the compact history omits because its tracked values
did not change. `through` identifies the requested boundary;
`recordedTransitions` reports the latest recording length. `caughtUp` is true
only when the page reaches the current recording end and its public state matches
the active run. `pending` still identifies an in-progress UI transition.

Historical frames include Act, Ascension, public run settings, location, player resources/items and enemy
status. Choice descriptions contain labels, **not executable selectors or input
values**. Log changes report appended lines; `reset: true` means the recorded log
was replaced or rewound, not that every repeated line is a new action. Card
payments, copied cards and rewinds use the same semantics as recent history.

This is the public interpretation of the same recording used by **Download run
log**, not a raw replay-file download: hidden hands, draw order, future reward
supplies, RNG, replay patches and credentials remain excluded. Unrecorded
internal effects cannot be recovered, and no per-action timestamps are invented.
Menus, online games, tutorials, replays, and missing/loading recordings return an
explicit history-query error. Use `get_current_run` for current-game advice.

## Recorded transition history

The rules engine already has explicit run/combat phases and pure state-transition
functions. The local screen stores the run with React `useState`; it does not
dispatch every gameplay action through a single React reducer. Its existing
`useRunLog` recorder saves committed state patches for replay.

Assistant history now uses the pure `reduceRunHistory(state, event)` state machine:
`idle -> loading -> ready`, with explicit `commit`, `clear`, and `fail` events.
It reconstructs recorded transitions incrementally and exports only a public
projection. It does not change the game rules or infer actions from mouse clicks.

Recorded local plays made while the assistant was disconnected can be read after
pairing. After a refresh, **Resume** the run to load its persisted recording;
the main menu deliberately does not expose a previous run's history. History is
currently unavailable for online games, tutorials, and replays, and a missing or
failed recording is reported rather than replaced with guessed actions.

Check `history.status` and `history.caughtUp` before treating it as current.
Each transition contains its recording index, public `before`/`after` frames,
`cards`, and `cardEnergySpent` per player. `cardEnergySpent` is the change in the
engine's card-payment counter within the same turn; a turn reset or rewind has
no comparable payment counter. Card `effectEnergy` is the resolution parameter,
**not necessarily another payment**, especially for copied cards. Several card
resolutions can belong to one committed transition, so the net Energy change
must not be attributed to an individual resolution without further evidence.

The retained history sets `truncated` when older public transitions have been
dropped. `cardEventsTruncated` flags a gap in the engine's bounded presentation
events; `timelineReset` distinguishes a rewind from a new card play. This is a
history of recorded committed states, not every internal effect or UI click,
and does not invent timestamps that the replay recorder did not store.

The publisher samples at most once per second while paired and sends changes.
Each assistant request also asks the browser for a new snapshot immediately.
If the browser cannot respond within five seconds, the request fails rather than
returning a cached state. A `pending: true` response is mid-transition; inspect
again before giving actionable advice.

The screen snapshot reuses the visible-UI readers in `useWebMcp.ts`, without
rotating its control IDs or acknowledging its announcements. Recorded history
is projected inside the browser; raw state, replay patches, credentials, RNG,
hidden draw order, and other players' private cards are never exported.
The feed does not open overlays: to discuss a deck, map, or pile that
is not currently visible, open that view yourself. Long screen text has an
explicit `textTruncated` flag.

## Privacy and limitations

Pairing is opt-in. The companion checks both the exact browser origin and a
random 256-bit pairing secret. Command-line reads require that secret too.
Only read-only inspection is exposed; there is no interaction endpoint.

The companion holds its received state in memory, not on disk. The game's
existing local replay recording remains in the browser's IndexedDB. The ignored
`tmp/live-run/connection.json` contains the local connection credentials, with
owner-only permissions. Do not copy, commit, or share it or the pairing code.
Normal companion shutdown removes that file. After a crash, confirm the old companion is no
longer running before removing its stale connection file and restarting.

This version requires the browser and companion on the same computer, with
reachable loopback networking (including any WSL boundary). A phone playing a
remote deployment cannot reach the computer's loopback service. Remote relays
are not implemented. A hosted HTTPS game also needs a browser that permits
loopback WebSockets/local-network access and an explicitly allowed origin;
local development is the supported starting point.

## Focused verification

```sh
node scripts/verify-live-run.mjs
node --experimental-strip-types scripts/verify-live-run-history.mjs
node --experimental-strip-types scripts/verify-live-run-browser.mjs
node --experimental-strip-types scripts/verify-webmcp-browser.mjs
```
