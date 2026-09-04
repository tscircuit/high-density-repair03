# Pad geometry and via-safety regression snapshots

These examples exercise the **post-routing DRC repair stage**, not initial
route planning. They demonstrate pad detection and construction of legal
layer-change candidates; they do not claim that an entire board or benchmark
is DRC-clean.

## Square pad corner

![Square pad corner](./square-pad-corner.snap.png)

The physical copper and trace are identical in both panels. Previously, the
checker treated this explicitly rectangular plated pad as a circle (gray
outline), missing its corner. The corrected checker reports the actual
**0.056 mm** trace-to-pad gap, below the **0.100 mm** minimum.

## Rotated pad and via

![Rotated pad and via](./rotated-pad-via.snap.png)

Again, the copper does not move. The old checker ignored the pad's 45-degree
rotation (gray outline). The corrected checker reports the **0.048 mm**
via-to-pad gap against the same **0.100 mm** minimum.

Both missed detections were verified by running the same physical inputs on
base commit `c16f524607897f78773f51cb0ca1cc94b15f3d6c`. The snapshot test keeps
explicit legacy-shape controls and asserts the corrected engine's measured
clearances; it does not embed a second copy of the old DRC engine.

## Pad-clear layer-change construction

![One-iteration via safety](./repair-via-safety.snap.png)

This comparison is limited to **one repair iteration**. The left panel retains
the actual base-commit output: a layer change removes the trace crossing but
places two new vias only **0.050 mm** from foreign pads.

The corrected constructor places each new via outside the pads' copper and
clearance regions, then builds the connecting trace segments at those
positions. The existing full-board DRC check evaluates that completed candidate.
The right panel has **two vias and zero DRC errors**, with the required
**0.100 mm** via-to-pad clearance and unchanged route endpoints. This fixes the
crossing in this example; it does not merely reject the unsafe candidate or run
an extra DRC-driven repair loop.

`layer-move-constructs-clear-vias.test.ts` also checks the constructor's output
directly, before any candidate scoring or force relaxation, using the real DRC
engine.

## Regeneration

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999 tests/pad-geometry-snapshots.test.ts tests/repair-via-safety-snapshot.test.ts
```

This regenerates the SVG snapshots and PNG previews. Normal tests compare the
SVGs exactly and assert the underlying DRC measurements. The PNGs are provided
for review, not used as platform-dependent pixel assertions.

The separate `mixed-via-pad-worst-contact-score.test.ts` covers the numerical
scoring fix: partial overlap improvements retain their quantitative score when
via-to-pad errors also exist. It is not a geometric before/after route change.
