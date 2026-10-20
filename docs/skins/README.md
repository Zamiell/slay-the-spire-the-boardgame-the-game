# Skins: index

A skin changes how a hero looks and sounds, never how it plays. The requirements, registration steps and tests are in
`SKIN-REQUIREMENT.md` at the repository root; purchase and ownership are in `docs/shop.md`.

| Skin | Hero | Price | Provenance and pipeline docs |
|---|---|---|---|
| Kratos (`kratos`) | Ironclad | 2,500 | `kratos-art.md` (idle, attack, VFX, sounds), `kratos-menu-art/` (portrait, wallpaper, Energy orb), `kratos-card-art/` (card art), `kratos-noncombat/` (merchant, treasure) |
| Ironclad-chan (`monogatari_ironclad`) | Ironclad | 2,500 | `../monogatari-skins/` (README, combat, noncombat and card pipelines), `monogatari_ironclad-card-art/manifest.json` |
| Silent-chan (`monogatari_silent`) | Silent | 2,500 | `monogatari_silent-art/` (idle, attack, VFX, sounds, portrait, wallpaper, Energy orb), `monogatari_silent-card-art/`, `monogatari_silent-noncombat/` |
| Defect-chan (`monogatari_defect`) | Defect | 2,500 | `../monogatari-skins/`, `monogatari_defect-card-art/manifest.json` |
| Watcher-chan (`monogatari_watcher`) | Watcher | 2,500 | `monogatari_watcher-art/`, `monogatari_watcher-card-art/`, `monogatari_watcher-noncombat/` |
| Rimuru Tempest (`anime_slime_boss`) | Slime Boss | 2,500 | `anime_slime_boss-art/` (idle, summon, attack, VFX, sounds, portrait, wallpaper, Energy orb), `anime_slime_boss-card-art/` (54 skinned cards, the 13 Slime cards keep the default face), `anime_slime_boss-noncombat/` |

Shared by every skin:

- `attack-animation.md`: the generic staged attack (config format, generated CSS and table, how to make a skin's attack).
- `campfire-scenes.md`: the campfire composed from one camp background and one seated sprite per hero, and how to add a sprite.
- `kratos-card-art/README.md`: the card-art pipeline (`scripts/art/skin-cards/`) every skin's cards go through.

Two sets of skins coexist. Ironclad-chan and Defect-chan ([`../monogatari-skins/`](../monogatari-skins/README.md)) were built
first with pose-pair attacks (`ready`/`impact`, `charge`/`release` drawings on the original hero clocks, no `energyOrb` or
`stagedAttack` trait). Silent-chan, Watcher-chan and Rimuru Tempest follow Kratos: a config-driven staged attack (`attack-animation.md`), their
own Energy orb and sounds. Both kinds go through the same registry, wallet, Shop, Profile, card faces and campfire sprite;
`SKIN-REQUIREMENT.md` describes the two attack paths.

The Monogatari-style skins are original characters in the style of the Monogatari anime series (SHAFT). The key-art frames used
as private style references are not committed; each manifest records them by description and SHA-256 only (see `ATTRIBUTION.md`).
Rimuru Tempest is a fan illustration named after the character Rimuru Tempest (*That Time I Got Reincarnated as a Slime*), the human form of Slime Boss, drawn from the project owner's own reference image (recorded by SHA-256, not committed), the first skin of a
Downfall hero: she stands in her Slime formation and has a summon drawing (`<skin>-spawn.webp`) for the Slime cards.
Every base hero has a skin, and so does Slime Boss.

## Pages package size

The Pages deploy builds `dist`, deletes what the CDN rules serve instead (Safari `.mov` and `*-attack.png` media, `hero-*-idle.webp`,
background music) and fails above a cap
(`.github/workflows/pages-deploy.yml`, checked by `scripts/verify-pages-deploy.mjs`). GitHub Pages refuses sites over 1 GB, so
the cap keeps 100 MB of margin: **900,000,000 bytes**. Measured on 2026-10-19 with all six skins, after those deletions
(`vite build` with the workflow's variables): **882,313,636 bytes**, so 17.7 MB of headroom. On 2026-10-12, with five skins,
it was 863,204,536 bytes (36.8 MB of headroom); Rimuru Tempest adds 16.9 MB to `dist` (16,896,121 bytes in files named for
her: 8.76 MB of card faces, 4.36 MB of 448 px faces, 2.07 MB of text-free card art, 1.7 MB of combat, merchant, treasure,
menu and campfire art), and the rest of the growth is the base game's. Before Silent-chan and Watcher-chan
(origin/master with Ironclad-chan and Defect-chan) it was 825.9 MB against the old 850,000,000 cap, which the two new
skins (about 37.3 MB in `dist`: 863.2 - 825.9) would have exceeded.

A skin costs 17 to 21 MB of `dist` (its composited card faces, about 9 to 10 MB at full size and 4 to 5 MB at 448 px, 2 to 2.6 MB
of text-free card art, and 1 to 4 MB of combat, merchant, treasure and menu art), so **a further skin fits only at the low end of that range**, and none after it, without a structural change: serve the `skin-cards*` folders through the CDN rules in `assetPath`, or lower the faces' WebP
quality (see below).

What was considered before raising the cap: no genuine waste turned up (four byte-identical card thumbnails, and the two
Ironclad-chan/Defect-chan attack previews, 0.4 MB, which no screen loads). The skin card art folder is only requested when a
card's scan is unavailable, but it is the fallback face, so it stays. Re-encoding the skins' card faces at WebP quality 80
instead of 90 would save about 31% (9 MB for Silent-chan and Watcher-chan, 39 to 41 dB PSNR against the shipped faces,
which are already a lossy re-encode of lossy scans); it would not bring `dist` under the old cap either, so it was not applied.
