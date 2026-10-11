# Focused online skin verification

Ran `node scripts/verify-monogatari-online-browser.mjs` successfully against the
real Vite app and ephemeral room server. Four scenarios: each new skin on
1440x900 desktop and844x390 horizontal phone. No retries or legacy umbrella.

Assertions cover owned entry/lobby portrait, authoritative base character+skin,
live default/skin preference updates, public teammate combat art, owner skinned
card faces, unchanged Silent viewer card faces, private hand/draw/deck snapshots,
combat reconnect, complete party campfire decode (3840x2161), and campfire
reconnect. This is the exact relevant online set: cosmetics touch public seat
presentation but must not alter private card data or reconnect persistence.

Repeatable evidence: `artifacts/monogatari-online/report.json`,24screenshots,
8owner/viewer WebM recordings (one per skin/screen/seat), plus full-timeline and
ending contact sheets extracted with ffmpeg. All eight recording contact sheets
were visually inspected along with full-size desktop and horizontal-phone
combat/campfire screenshots. Browserconsole/pageerror list is empty.

The first audit noticed one screenshot taken mid-opening-deal, with temporary
overlapping card faces. The verifier now waits for `.card--drawn` to disappear;
the final full four-scenario run passed with settled screenshots. This was an
evidence-quality fix, not a product change. Final recordings show normal card
deal transitions and stable hero/campfire placement; no missing skin, changed
viewer hand, ghost OG replacement, extra limbs or flame overlap was found.

Combat attack/defend physics and solo Shop/Profile workflows remain owned by the
main/combat focused verifiers; this script does not claim attack playback audit.
