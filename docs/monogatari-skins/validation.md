# Release validation

Base: `origin/master` at `6bba5e8f`. Display names **Ironclad-chan** and
**Defect-chan**; stable internal IDs remain `monogatari_ironclad` and
`monogatari_defect`. Two purchases total 5,000 coins. No gameplay mechanic,
coin-earning rule or authentication protocol was changed.

## Exact relevant checks

The implementation adds cosmetic registrations, asset pipelines, attack
presentation, card faces and one five-rack Shop layout. Therefore the owning
checks are skin purchase/profile/run presentation, attack clocks/lifecycle,
card-face selection, noncombat presentation, and online public cosmetic state.
The legacy `verify-browser.mjs` umbrella and full browser lane were **not run**.

| Check | Why this check owns the change | Final result |
|---|---|---|
| New skin UI E2E, Chromium + WebKit | Both 2,500-coin purchases, exact names/equip persistence, real hand scans, select/Neow/campfire/Merchant/treasure, attacks/restoration/reduced motion, desktop + horizontal phone | Passed 4/4 per engine, zero errors |
| New animation E2E, Chromium + WebKit | Cold decode latch, each cel/clock, one painted body, row/multiple hits, cast/evoke origin, queue/restoration/disconnect/death/reduced-motion scale | Passed 8/8, zero errors |
| New online E2E | Two real seats, lobby choice propagation, viewer hand privacy, combat/campfire and reconnect | Passed 4/4, zero errors |
| Existing Shop browser | Five racks fit, existing packs/coins/refusals/browse/keyboard unchanged | Passed |
| Existing skin Profile browser | Independent hero groups, owned/default/locked choices, persistence and horizontal fit | Passed |
| Existing Kratos skin + card-face browsers | Previous skin's solo/online/campfire/reconnect and all card surfaces stay unchanged | Passed |
| Existing Kratos animation, Chromium desktop | Shared presentation code retains weighted staged combo, targets, sound, cold load, scale, layering, restoration | Passed |
| Wallet + account-wallet verification | Existing purchase/migration/isolation/idempotent persistence still work | Passed |
| Asset inventory + card-face sync check | Every art key/path/dimension/byte cap, party scene and card variant exists | Passed |
| Animation exporter `--check`, head calibration `--check` | Native alpha, normalized anatomical/weapon/ground registration and byte/hash parity | Passed |
| Card source/output audit | 1,660 provenance hashes, 137 illustrations, 274 full faces + 274 thumbnails, bounded sizes | Passed |
| Noncombat rebuild/hash/component audit | 218 output hashes, 208 scenes, four fragment-free hands, deterministic export | Passed |
| Pipeline selection verifier | New focused owner selection; disposable Git graph fixtures independent of real signing service | Passed 15/15 |
| `verify-all --changed=origin/master --lane=light --jobs=4` | Required release gate, with no retry flags | Passed 68/68; rerun on final staged snapshot before delivery |
| Fresh independent reviewer batch | Required three clean reviews of the final snapshot | Mandatory before commit; review results retained with delivery evidence |

The first light gate exposed stale selector counts after adding focused suites
and a disposable Git fixture inheriting the local signing service. Those checks
were repaired, not waived. Actual delivery commits retain the user's signing
configuration; only throwaway test repositories disable signing.

## Visual and recording audit

All generated card sheets and base/upgraded faces were inspected. Combat native
sources and registered keyframes were inspected at full size, including enlarged
hands. Twelve campfire compositions and representative full party scenes were
inspected, plus portraits, standing art and all four treasure hands.

Repairs include the user-flagged idle grip, short sword/stance drift, crossed
arm-to-hand routing, Defect power-mask banner contamination, and adjacent-sheet
fragments in both treasure grips. The production drawings do not morph or pulse
body scale. A late-loading Defect attack keeps one latched chest-cast fallback,
rather than changing projectile origin mid-flight.

Live production-screen E2E recordings and derived frame sheets are kept under
`artifacts/monogatari-skins/`, `artifacts/monogatari-combat/browser/`, and
`artifacts/monogatari-online/`. The scripts in the README recreate that evidence.
The T3 collaborative preview's snapshot/click/recording operations repeatedly
returned client automation errors; no successful manual preview recording is
claimed. The inspectable recordings here are from the repeatable focused browser
verifiers using real game-engine events and production screens.

The final UI reports are `artifacts/monogatari-skins/{chromium,webkit}-report.json`;
animation report is `artifacts/monogatari-combat/browser/report-all.json`;
online report is `artifacts/monogatari-online/report.json`. All eight animation
recordings and all eight online owner/viewer recordings were sampled and visually
inspected. Final UI screenshots show the exact requested Shop/Profile labels,
settled wallpapers and card deals; ready/contact/recovery frames retain consistent
physical scale. The original character name on character selection remains
Ironclad or Defect, because these are cosmetics rather than new characters.

Post-push CI and deployment SHA proof are collected in local task artifacts and
the GitHub **Build and test** workflow attached to the delivered commit. They
must succeed before the task is reported finished.
