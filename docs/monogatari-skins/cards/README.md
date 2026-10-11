# Monogatari card art production

Every released Ironclad card (68, including all seven Slayer cards) and Defect card (69, including all seven Slayer cards and the alternate Claw Pack) receives a distinct illustration. Both faces of each card retain the original physical scan: original title, cost, rules, type tab and frame.

## Generation

- Exact model: `gpt-image-2.5-sunburst`; high quality; native 1536×1024 PNG.
- Unmodified bundled imagegen skill CLI, `edit`, five reference inputs: all three user style samples, the approved character identity, and a four-panel grid of each corresponding original card artwork.
- Each sheet uses a precise 2×2 extraction grid with four individually described card actions. Prompts are in `docs/monogatari-skins/prompts/cards/`. Native generated sheets are retained in `scripts/art/sources/monogatari/cards/`.
- The character identities are the repaired Ironclad idle and the clean Defect idle; anime style comes from the user samples, not their named characters.

`python3 scripts/art/skin-cards/monogatari.py prepare` rebuilds reference grids and prompts. Generation calls use the bundled CLI directly:

```sh
python3 "$HOME/.codex/skills/.system/imagegen/scripts/image_gen.py" edit \
  --model gpt-image-2.5-sunburst --quality high --size 1536x1024 --no-augment \
  --image STYLE1 --image STYLE2 --image STYLE3 --image IDENTITY \
  --image artifacts/monogatari-cards/refs/ironclad-01.png \
  --prompt-file docs/monogatari-skins/prompts/cards/ironclad-01.txt \
  --out scripts/art/sources/monogatari/cards/ironclad-01.png
```

Repeat for every prompt, substitute the matching owner identity and reference grid. The user samples remain external attachments and are identified by hashes in manifests; they are not redistributed.

## Registration, masks and export

Ironclad reuses the proven Kratos scan registration and masks. Defect uses its own registrations and six masks derived from the physical Defect scans, including Slayer scans. A proven base-template shape guard (2px allowance before scan registration) excludes banner-tail variance from the art mask; normal power masks otherwise include a thin frame strip. The repaired normal-power overlays were visually audited. `monogatari.py masks` reconstructs these (Pillow, NumPy, OpenCV and SciPy). `monogatari.py export` needs only Pillow and NumPy.

Export creates 748×420 text-free art (≤40KiB), full original-size card faces (≤160KiB), and original 448px thumbnails (≤80KiB). Pre-encode RGB pixels outside the registered soft art mask are checked byte-for-byte against the original decoded scan. Delivery uses the same quality-90 WebP codec as Kratos: **post-encode pixels are not claimed byte-exact**. Representative unchanged-scan re-encoding measurements are retained in `codec-baseline.json`. Every delivered face reports protected-region RMS and maximum codec differences in `docs/skins/monogatari_<owner>-card-art/manifest.json`.

Each manifest retains model/quality, native source/prompt/output SHA256, corresponding original artwork SHA256, reference identity/style SHA256, extraction coordinates, and each face's original scan/output SHA256 and geometry. Coverage reports in this folder and artwork/face contact sheets in `artifacts/monogatari-cards/` are repeatable export artifacts.

After both exports are complete, `node scripts/sync-skin-card-faces.mjs` updates the runtime inventory. Runtime desktop/horizontal-phone E2E validation is coordinated by the parent task.
