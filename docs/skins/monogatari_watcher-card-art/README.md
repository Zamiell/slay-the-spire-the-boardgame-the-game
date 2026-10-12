# Monogatari Watcher skin card art

Every Watcher card (the 64 base-set cards and the 7 Slayer Pack `slayer_*` cards) has an illustration of the original anime heroine of the `monogatari_watcher` skin, drawn in the style of the Monogatari series (SHAFT, Akiyuki Shimbo). The art is generated with `gpt-image-2.5-sunburst`, quality `high`, 1536x1024, through the bundled imagegen CLI (`edit`, two candidates per card; 72 calls: 71 cards plus one regeneration of Swivel). It is composited into the existing Watcher card scans so the frame, banner, title, cost orb, type tab and rules text stay the scans' own pixels; only the art window changes. The pipeline is the shared `scripts/art/skin-cards/` one described in `docs/skins/kratos-card-art/README.md` (run with `--skin monogatari_watcher`, recipe `monogatari`, owner `watcher`).

## References, in a fixed order per call

1. Two of the three Monogatari style frames, chosen per card (`plan.json` `styles`): style authority only (thin precise black linework, huge flat eyes with a crisp highlight, shard-like flat hair, elongated limbs, pointed chins, flat cel colour with one hard shadow step, cloudless saturated sky or hard diagonal shadow cuts). The prompt forbids copying any character, face, costume, hair or prop from them.
2. The approved Watcher skin identity sheet (violet short kimono-robe with wide sleeves and a grey-blue obi, white blindfold with a gold closed-eye sigil, magenta ribbons, gold-tipped staff, dark-indigo ponytail with a gold hairpin, dark leggings, bare feet).
3. The Watcher card scan and its original text-free art, so the card keeps its meaning.

The style frames are copyrighted key art and the identity sheet is a generated working file; none of them is committed. Only their description and SHA-256 are recorded in `manifest.json`:

- `poster`: Monogatari series second-season key art, extreme low camera angle, cloudless cobalt sky, white geometric masts, stacked diagonal figures. SHA-256 `0a006524048361ec815fb8d9648c269da8bf507224c0cd6b7a9b07ed8de7fa90`.
- `closeup`: Monogatari series close-up frame, huge flat eyes with crisp highlights, shard-like flat hair, fine linework, painted sea and cloud backdrop. SHA-256 `eae8b06c365b04b53a3aa6723091f172f7ae7641009a31a04ab40d7f43471762`.
- `classroom`: Monogatari series group frame, hard diagonal shadow cuts, cracked grey wall with one hot flat colour panel, geometric clutter, long limbs. SHA-256 `1e7fdbc9e0c88f3925a35d4a23b49fe2824a86c9d2bdd8d09d30d174462e05c3`.
- identity sheet (`identity/watcher-idle.png`, generated): SHA-256 `bdb07ae01eb9225ad6609fc5641afbc7136cbf4d9ce2b3e75d83dfacd3ba7e83`.

`scripts/art/skin-cards/skins/monogatari_watcher/plan.json` holds one scene sentence and the style frames per card. `prompts/` keeps the exact prompt of every card. `manifest.json` records model, quality, size, the reference hashes and per card the scene, chosen candidate, source, prompt and exported art SHA-256. Rejected candidates are not kept in git (the 71 unselected ones and the two first Swivel candidates stay in the scratch folder).

## What was picked and why

Each card was viewed as a composited face with both candidates side by side, plus full-size views for doubtful hands and faces. Picks favour the candidate whose scene matches the card text (for example Bowling Bash shows three enemy silhouettes knocked over, Halt shows a wall of light in front of the raised palm, Prostrate shows her bowed with the staff laid down), whose hands and staff are anatomically clean, and whose focal shapes survive the window (power cards sit inside the oval, nothing important under the banner or chevron). Where two candidates were equal the one with the calmer, less cluttered composition was kept.

Swivel was regenerated during the original draft. Both first candidates drew her falling backwards at a tilted camera with disjointed legs, so the scene was rewritten (upright wide stance, both legs visible, high three-quarter camera) and two new candidates were generated; the second was kept.

The audit also regenerated Tranquility with `gpt-image-2`, high quality at1536x1024, from two original style references, the original character identity, and the original card scan/art. Its former staff branched into two directions at the hand. The replacement has one continuous straight staff and two readable grips. A deterministic crop `[0,40,1536,904]` keeps hairpins and feet inside the shallow card window without resampling. The exact ordered inputs, raw output hash and crop are recorded under this card's `regeneration` metadata.

## Outputs

- `scripts/art/sources/monogatari_watcher-skin-cards/<card id>.webp`: the selected candidate, lossy WebP q78-90, each at most 150 KiB.
- `public/assets/skin-card-art/monogatari_watcher/watcher/<card id>.webp`: 748x420 text-free art, at most 40 KiB (the CSS fallback face).
- `public/assets/skin-cards/monogatari_watcher/<key>.webp` and `public/assets/skin-cards-sm/monogatari_watcher/<key>.webp`: base and upgraded faces at the scan's size and at 448 px (142 faces each), keyed like the Watcher scans.

## Validation

`validate.py --owner watcher` over all 142 faces at both sizes: outside-window difference 0.00, halo ring deviation worst 4.0% (Conjure Blade), mean 0.23%. A flat-colour composite over all faces leaves no pixel of the original art inside the window and changes nothing outside it. Published WebP faces differ from their scans outside the window only by re-encode noise (mean at most 2.6, under 0.3% of pixels above 24).
