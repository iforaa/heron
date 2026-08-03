# Delivery and compatibility

The evaluator, static renderer, CSS compiler, lint, frames, and video share the
same scene and frame-clock semantics. The compiler states held 0%/100% endpoints,
retains precise keyframe percentages, and verifies serialized baked values on a
dense grid against each channel’s `EPSILON`.

SVG is the reference artifact. Review it with sheets/frames and, when applicable,
match it to source artwork.

Lottie is a separate compiler. Heron has property-value parity tests for
position, rotation, scale, opacity, draw, easing, held endpoints, and fractional
duration frame clocks. Clips, masks, gradients, skew, and path morphing are
currently refused. A Lottie file cannot force a player’s loop option; obey the
warning for `once: true` and configure `loop: false` in the host application.
Use `heron lottie scene.ts --strict` in a delivery gate when any backend warning
must block the artifact; strict mode does not write a warned JSON file.

`heron lottie scene.ts --check` replays representative frames through Skia's
real Skottie player (via the optional `canvaskit-wasm` package), rasterizes them,
and diffs them against Heron's SVG evaluator. A failed overlap gate does not
write the Lottie artifact. This is deliberately independent of Heron's
property-replay tests: a compiler and a model copied from that compiler are not
enough evidence about a production player.

Path morphing is emitted as CSS `d: path(...)`. Use identical command topology,
test the target browser set, and retain a non-morph fallback when browser support
is part of the product requirement. Morphs inside reusable clip/mask definitions
are rejected rather than frozen silently.

Fonts converted to outlines become redistributed font geometry. Confirm that the
font license allows that use; examples and reusable assets should prefer OFL or
otherwise explicitly licensed faces.

`examples/chessrun-logo.ts` resolves Noto Sans and Noto Sans Symbols 2 from
Fontsource packages. Both packages declare OFL-1.1, so the example is reproducible
without relying on proprietary operating-system fonts.
