# Defect-chan evoke follow-up: failure contract (before implementation)

- Lightning/dark evokes must focus an orb, extend the casting hand and fire beams
  from the hand to every authoritative target, not eyes or a flying attack orb.
- Exactly one full-body cel may be painted at a time, including simultaneous
  Dual Cast events, mixed/queued evokes and overlap with a normal attack.
- Focus/cast/recovery must fit the existing 240ms beam onset, 520ms beam and
  900ms pose duration; feet/head/body scale stay registered.
- Impact events may persist for 1800ms, but the completed 900ms evoke pose must
  release body ownership so a subsequent normal attack can charge and release.
- Masking an overlapping attack must not cancel/restart its body animation;
  its original pose and projectile clocks continue under the evoke layer.
- Correct lightning/dark focus visuals; no lightning-colored orb for dark.
- No late-decode blank body, mid-flight origin jump or duplicate idle. Cold pose
  fallback is latched for that evoke and remains safely chest aligned.
- Targets, damage, hit timing, beam SFX and gameplay/room state are unchanged.
- Original Defect keeps its existing evoke origin and beam behavior. Frost,
  passive/end-turn effects and normal Defect-chan projectile attacks are unchanged.
- Reduced motion, restoration/reconnect, death and reset clear pose layers and
  leave a decoded static/idle hero without stuck opacity.
- Desktop and horizontal phone in Chromium/WebKit must produce inspectable
  phase screenshots and recordings, not only DOM geometry measurements.

Focused E2E will use real engine Dual Cast / evokes, existing production fixture,
per-frame one-body checks, source/target geometry and lifecycle checks. No new
unit tests or runtime asset generation are needed; reuse registered hero/release
cels plus existing lightning/dark focus VFX.
