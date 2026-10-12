# Skins: index

A skin changes how a hero looks and sounds, never how it plays. The requirements, registration steps and tests are in
`SKIN-REQUIREMENT.md` at the repository root; purchase and ownership are in `docs/shop.md`.

| Skin | Hero | Price | Provenance and pipeline docs |
|---|---|---|---|
| Kratos (`kratos`) | Ironclad | 2,500 | `kratos-art.md` (idle, attack, VFX, sounds), `kratos-menu-art/` (portrait, wallpaper, Energy orb), `kratos-card-art/` (card art), `kratos-noncombat/` (merchant, treasure, campfire) |
| Ironclad-chan (`monogatari_ironclad`) | Ironclad | 2,500 | `../monogatari-skins/` (README, combat, noncombat and card pipelines), `monogatari_ironclad-card-art/manifest.json` |
| Silent-chan (`monogatari_silent`) | Silent | 2,500 | `monogatari_silent-art/` (idle, attack, VFX, sounds, portrait, wallpaper, Energy orb), `monogatari_silent-card-art/`, `monogatari_silent-noncombat/` |
| Defect-chan (`monogatari_defect`) | Defect | 2,500 | `../monogatari-skins/`, `monogatari_defect-card-art/manifest.json` |
| Watcher-chan (`monogatari_watcher`) | Watcher | 2,500 | `monogatari_watcher-art/`, `monogatari_watcher-card-art/`, `monogatari_watcher-noncombat/` |

Shared by every skin:

- `attack-animation.md`: the generic staged attack (config format, generated CSS and table, how to make a skin's attack).
- `campfire-scenes.md`: scene naming, the manifest, the fallback for a party without its own scene, and the size budget.
- `multi-skin-noncombat/`: 72 parties wearing two or three of Kratos, Silent-chan and Watcher-chan.
- `mixed-skin-noncombat/`: 143 combinations mixing Silent-chan/Watcher-chan with Ironclad-chan/Defect-chan.
- `fresh-campfires/`: original inputs, exact accepted prompts and native-resolution export hashes for all 407 fresh scenes.
- `kratos-card-art/README.md`: the card-art pipeline (`scripts/art/skin-cards/`) every skin's cards go through.

Two sets of skins coexist. Ironclad-chan and Defect-chan ([`../monogatari-skins/`](../monogatari-skins/README.md)) were built
first with pose-pair attacks (`ready`/`impact`, `charge`/`release` drawings on the original hero clocks, no `energyOrb` or
`stagedAttack` trait). Silent-chan and Watcher-chan follow Kratos: a config-driven staged attack (`attack-animation.md`), their
own Energy orb and sounds. Both kinds go through the same registry, wallet, Shop, Profile, card faces and campfire fallback;
`SKIN-REQUIREMENT.md` describes the two attack paths.

The Monogatari-style skins are original characters in the style of the Monogatari anime series (SHAFT). The key-art frames used
as private style references are not committed; each manifest records them by description and SHA-256 only (see `ATTRIBUTION.md`).
Every base hero has a skin.

## Pages package size

The Pages deploy builds `dist`, deletes what the CDN rules serve instead (Safari `.mov` and `*-attack.png` media, `hero-*-idle.webp`,
background music, every campfire scene but the empty camp) and fails above a cap
(`.github/workflows/pages-deploy.yml`, checked by `scripts/verify-pages-deploy.mjs`). GitHub Pages refuses sites over 1 GB, so
the cap keeps 100 MB of margin: **900,000,000 bytes**. Measured on 2026-10-12 with all five skins, after those deletions
(`pnpm build` with the workflow's variables): **863,204,536 bytes**, so 36.8 MB of headroom. Before Silent-chan and Watcher-chan
(origin/master with Ironclad-chan and Defect-chan) it was 825.9 MB against the old 850,000,000 cap, which the two new
skins (about 37.3 MB in `dist`: 863.2 - 825.9) would have exceeded.

A skin costs 18 to 21 MB of `dist` (its composited card faces, about 10 MB at full size and 5 MB at 448 px, 2.6 MB of text-free
card art, and 1 to 4 MB of combat, merchant, treasure and menu art), so **about two more skins fit** before the cap, and
none once it is reached without a structural change: serve the `skin-cards*` folders through the CDN rules in `assetPath` the way
the campfire scenes are, or lower the faces' WebP quality (see below).

What was considered before raising the cap: no genuine waste turned up (four byte-identical card thumbnails, and the two
Ironclad-chan/Defect-chan attack previews, 0.4 MB, which no screen loads). The skin card art folder is only requested when a
card's scan is unavailable, but it is the fallback face, so it stays. Re-encoding the skins' card faces at WebP quality 80
instead of 90 would save about 31% (9 MB for Silent-chan and Watcher-chan, 39 to 41 dB PSNR against the shipped faces,
which are already a lossy re-encode of lossy scans); it would not bring `dist` under the old cap either, so it was not applied.
