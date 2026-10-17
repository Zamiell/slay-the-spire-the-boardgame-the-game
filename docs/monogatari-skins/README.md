# Monogatari-inspired anime-girl skins

**Ironclad-chan** and **Defect-chan** are original adult anime-girl interpretations
of **Ironclad** and **Defect**, sold
for **2,500 coins each** through the existing Shop and account-wallet pipeline.
Visual IDs: `monogatari_ironclad` and `monogatari_defect`. They are cosmetic skins,
not new playable characters: cards, rules, RNG, progression and multiplayer seat
ownership remain those of their original hero. Kratos remains available, and Silent-chan and Watcher-chan, built later in
the same style with a config-driven staged attack, are documented in [`../skins/`](../skins/README.md), which indexes all five.

## Complete asset pipeline

- Three registered full-body combat drawings per skin, animated idle, deterministic
  attack preview, static/reduced-motion hero and lobby thumbnail. Production attacks
  step complete cel drawings on the original 1800ms/1650ms clocks, rather than
  morphing limbs or crossfading double bodies. See [combat audit](combat-audit.md).
- 137 distinct card illustrations (68 Ironclad, 69 Defect), including their Slayer
  Pack cards, with base/upgraded full-size and thumbnail card faces. Original
  names, rules, costs and frames are protected before encoding. See
  [card pipeline](cards/README.md) and the per-skin manifests in `docs/skins/`.
- Portraits, character-select wallpapers, standing Merchant-arrival figures and
  separate reach/grip treasure hands for both skins. See [noncombat pipeline](noncombat-pipeline.md).
  Their seated campfire sprites follow [`../skins/campfire-scenes.md`](../skins/campfire-scenes.md).

## Generation and provenance

Selected drawings were generated with **`gpt-image-2.5-sunburst`**, high quality,
using the unmodified bundled image-generation skill CLI. Character identity and
pose references came from the original game's assets, the user-provided
Monogatari samples, and accepted prior identity drawings. The private style
attachments are referenced by hashes/paths and are not redistributed here.
Accepted native PNG sources, generation prompts and source/output SHA256
manifests are retained. Offline composition, uniform registration and WebP
encoding do not redraw anatomy or remove native alpha.

The user-flagged Ironclad idle grip was repaired before pose generation. Further
QA rejected a short sword, inconsistent stance and swapped arm-to-hand routing;
accepted poses preserve grip identity, head/body scale, sword length and foot
baseline. Defect's cast originates at her forward palm. Lightning/dark evokes
focus an orb and fire connected beams from her extended palm, not her eyes.
Cold evoke art stays on a latched chest fallback. See [evoke follow-up](evoke-audit.md).
Native transparent hidden RGB is not chroma-keyed away.

## Rebuild

```sh
python3 scripts/animation/monogatari.py
python3 scripts/animation/monogatari.py --check
python3 scripts/calibrate-hero-head.py --check
python3 scripts/art/export-monogatari-noncombat.py
python3 scripts/art/skin-cards/monogatari.py --help
```

The two art pipeline documents describe the exact offline export commands.
Rebuilding approved assets requires Pillow and the original reference scans kept
locally by the project's existing sync pipeline. Regenerating model drawings is
separate, requires authenticated API access, and is not part of a game build.

## Repeatable browser evidence

Failure modes were recorded **before implementation** in [failure-modes.md](failure-modes.md).
Focused E2E verifiers exercise production screens and real engine events:

```sh
node --experimental-strip-types scripts/verify-monogatari-skins-browser.mjs
node --experimental-strip-types scripts/verify-monogatari-skins-browser.mjs --webkit
node --experimental-strip-types scripts/verify-monogatari-animation-browser.mjs
node --experimental-strip-types scripts/verify-monogatari-online-browser.mjs
```

Desktop and horizontal phones only. The verifiers write inspectable screenshots,
recordings and JSON reports under `artifacts/monogatari-*`; those generated local
artifacts are ignored, not shipped to players. Coverage includes purchases,
owned/default equip persistence, real skinned cards, menus, campfires, Merchant
arrival, treasure pickup, complete attacks/recovery, reduced motion, cold loading,
restoration and teammate/reconnect presentation. Existing Kratos/shop/profile
focused verifiers are retained as regression checks.

The release record is [validation.md](validation.md). A passing source export or
an attack-preview WebP is not a claim of live gameplay audit; browser recordings
are inspected separately before delivery.
