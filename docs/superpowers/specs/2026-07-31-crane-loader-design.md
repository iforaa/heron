# Crane Loader — design

2026-07-31. A looping loading animation for the Tenfore mobile app: the traced
crane runs in place at the center of the icon's ring, and the ring spins around
it as a dashed arc. Replaces the placeholder `crane-walking.svg` bird
(ellipse-and-rectangles) currently in the app's assets.

## Concept

- The crane runs in place at the center of the composition; nothing translates.
- The icon's ring — two unequal arc segments whose gaps are where the bird's
  head and leg cross it in the still mark — rotates continuously. In motion the
  gaps read as a dashed spinner, so the loader is the logo's own ring set
  spinning.
- Square 1024×1024 viewBox, transparent background.
- Production green `#2C7C4D` (the color of the app's shipped assets), not the
  examples' `#3ba064`. The far leg gets a lighter tint of the production green,
  serving the same depth-cue role as the rig's current `#8fc7a8`.

## Structure

New `examples/crane-loader.ts`, exporting the character as default.

- Reuses `craneRig()` from `examples/crane-rig.ts` unchanged in geometry.
  One targeted change to that file: `craneRig()` and its internal `leg()`
  accept an optional palette `{ink, far}`, defaulting to the current
  constants, so existing callers are unaffected.
- The loader wraps the rig in `part('bird')` and applies a constant track
  (the `offsetFarLeg` idiom — parts carry no static transform, so a constant
  keyframe pair is how a part is placed) that uniformly scales the bird down
  about the ring's center-bottom so a **full stride** fits inside the ring's
  inner edge. The scale factor is computed at authoring time from the rig's
  published stride bounds (`BIRD`), not eyeballed.
- The spinner is its own part: the two measured icon arcs
  (center (513, 427.7), r 359, the same arcs `crane-golf.ts` retains), pivot
  at the ring center.

## Motion

- **Loop:** one gait cycle per loop, duration 0.8 s. The character is cyclic
  (no `once`); every track starts and ends at the same value.
- **Gait:** `walkCycle()` tuned to a run — `stance ≈ 0.38` (below 0.5 gives an
  aerial phase), `reach` starting at ≈ 30° (tuned by eye on the frame sheet),
  `segments` passed from the rig so foot
  clearance is solved rather than guessed, and `facing: -1` because the traced
  bird faces left. Do not "fix" `facing` to the default: driving left-facing
  artwork with `facing: 1` produces the documented moonwalk artifact.
- **Legs:** near leg at phase 0, far leg at `phase: 0.5`, both via
  `applyGait()`. Far leg offset across/behind with `offsetFarLeg`.
- **Body:** `bodyBob` for the run bounce; a small constant forward lean on the
  neck (a few degrees) to sell running over walking.
- **Ring:** rotates exactly −360° over the loop with `linear` easing. One
  exact revolution plus linear rate makes the loop boundary invisible; one
  revolution per 0.8 s is normal spinner tempo.
- **No eye, no blink.** At loader size the bird stays the mark, not a
  character.
- **Known, accepted artifact:** a run in place means the planted foot "skates"
  by definition — nothing translates. This is the universal loader convention
  and is invisible at render size. The motion diagnostics' planted-foot check
  will flag it; that flag is expected here, not a bug.

## Outputs

From the exported character, two compiled artifacts:

- `crane-loader.svg` — the compiled animated SVG (web/preview target).
- `crane-loader.json` — Lottie via `compileLottie`, 60 fps, 48 frames.

Both are copied into the RN app repo's `assets/images/`; the app plays the
Lottie with the already-installed `lottie-react-native` (`~7.3.4`) with
`loop`, replacing the placeholder walking bird.

This is the Lottie exporter's first real consumer. Exporter bugs it surfaces
are fixed in `src/lottie.ts` as part of this work, not worked around in the
example.

## Verification

- `lint()` on the character passes.
- `compileLottie`'s report returns zero warnings.
- A rendered frame sheet (`renderSheet`) for visual inspection of the gait.
- Play the emitted JSON in the app (or a Lottie preview) to confirm the loop
  is seamless and the palette matches the shipped assets.

## Out of scope

- Any change to the still logo assets.
- App-side integration code beyond dropping in the two files (wiring the
  loader into specific screens is app-repo work).
- Additional acting (blinks, wing flaps, head turns) — revisit only if the
  pure gait reads stiff in review.
