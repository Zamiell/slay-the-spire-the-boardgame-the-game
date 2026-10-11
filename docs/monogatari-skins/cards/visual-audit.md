# Card artwork visual audit

## Completed scope

- All 35 native Sunburst sheets were inspected: Ironclad 01–17, Defect 01–18.
- All 137 distinct illustrations were checked for the original card's action/theme, readable focal composition, style/identity consistency, connected anatomy, plausible wrists and grips, weapon construction, no embedded text, and exact independent panel boundaries.
- All 274 base/upgraded card faces were inspected in full contact sheets (five readable pages per hero). Titles, costs, upgrade names, rules text, type tabs, frame edges, and power-circle crops remain the original scans. The alternate Claw Pack has separate art and both scanned faces.
- These contact sheets are not runtime screenshots; they are deterministic production exports. Actual desktop/horizontal-phone browser coverage belongs to the release's focused E2E validation.

## Issue found and fixed

The independently derived Defect normal-power variance mask initially connected a narrow banner-tail strip to the art window. This would have recolored part of the frame even though the first Slayer prototypes looked clean. The mask now intersects the matching proven base-template geometry with a 2px allowance before per-scan registration. The corrected normal-power mask spans x100–652 rather than x38–705. Normal/upgraded Loop and rare/upgraded Echo Form were inspected separately after repair, then every final Defect face was inspected.

Evidence:

- `artifacts/monogatari-cards/defect-mask-overlay.png`: rejected mask overlay.
- `artifacts/monogatari-cards/defect-mask-overlay-repaired.png`: repaired overlay.
- `artifacts/monogatari-cards/defect-powers-repaired.png`: repaired normal/rare/base/upgraded power faces.

## Repeatable artifacts and fidelity

`python3 scripts/art/skin-cards/monogatari.py export` rebuilds both whole artwork and face contact sheets:

- `artifacts/monogatari-cards/{ironclad,defect}-art-contact.jpg`
- `artifacts/monogatari-cards/{ironclad,defect}-faces-contact.jpg`
- Audited readable crops: `{ironclad,defect}-faces-page-01.jpg` through `-05.jpg` (1352px-high consecutive crops of each whole face sheet).
- Native-sheet audit montages: `{ironclad,defect}-QA-02.jpg`, `-04`, `-06`, `-08`, `-10`, `-12`, `-14`, `-16`; each shows the correspondingly numbered sheet and its successor at full 1536px width. The first sheets and final Defect sheet were inspected directly.

All 548 delivered face files (274 full + 274 thumbnail) passed protected-pixel equality **before encoding**, file budgets, and original scan geometry checks. Delivery is quality-90 WebP, like Kratos, not byte-exact RGB. Worst protected-region post-encode RMS is 2.49/255 for Ironclad and 2.73/255 for Defect; the unchanged-scan codec baseline's representative 24 faces have RMS 1.06–1.84/255. Full per-face values and source/output hashes are in each manifest.

No combat-animation or multiplayer/browser result is claimed by this offline card-art audit.
