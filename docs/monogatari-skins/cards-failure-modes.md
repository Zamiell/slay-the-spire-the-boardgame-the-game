# Card artwork failure modes (written before implementation)

- Missing released card or upgraded face; Slayer cards and the alternate Claw Pack are easy to omit.
- Scan key accidentally uses Ironclad for Defect, or slug differs from runtime key.
- The generated grid shifts, introduces labels, or merges panels; fixed-coordinate extraction then contaminates adjacent illustrations.
- Generic repeated character poses erase individual cards' semantic meaning; each tile needs its own original-art and scene reference.
- Character identity changes between tiles; armor, sword, gloves, head ornament and chest core must match the approved identities.
- Broken anatomy, sword grips or mechanics; inspect every panel and regenerate rejected candidates.
- Power artwork gets cropped by the circular art window; all focal subjects must live in central 75 percent of tile.
- Wrong frame mask or scan registration damages title, cost, text or frame, or leaves an old-art halo; derive Defect-specific masks/registration and retain Ironclad's proven masks.
- Lossy output encoding changes protected scan pixels; compare pre-encode RGB pixels outside mask exactly, use the same bounded quality90 WebP delivery codec as Kratos and report post-encode protected RMS/max explicitly.
- Missing native source, prompts or provenance makes rebuilds unverifiable; retain native PNG sheets and reference/source/output SHA256 in manifests.
- Stale runtime face index requests defaults or missing files; run the existing sync script once after both complete inventories exist.
- Overlarge delivery assets or excessive texture sizes slow mobile; keep 748x420 fallback art under40KiB, preserve existing full scan sizes and448px thumbnail sizes.

Validation artifacts: full artwork contact sheets, frame contact sheets, complete coverage and per-face protected-pixel comparisons in manifest/validation JSON. The parent owns runtime desktop/horizontal-phone E2E and actual-animation recordings.
