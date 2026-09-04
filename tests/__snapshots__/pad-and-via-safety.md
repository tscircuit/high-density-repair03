# Pad geometry and via-safety regression snapshots

These examples exercise the **post-routing DRC repair stage**, not initial
route planning. They demonstrate detection and candidate acceptance; they do
not claim that an entire board or benchmark is DRC-clean.

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

## Layer change with safe via placement

![One-iteration layer repair with clear vias](./repair-via-safety.snap.png)

Both panels use the same crossing input and **one repair iteration**. The old
solver accepts a layer change that removes the crossing but introduces two vias
too close to foreign pads. Merely rejecting those vias leaves the crossing
unrepaired. The corrected solver completes the layer change and via placement
as one candidate: it moves the new vias clear of the pads before applying the
full-board DRC acceptance check. It never accepts the unsafe intermediate route.

The right panel has two vias, unchanged connection endpoints, and **zero DRC
errors**. The test asserts this using the real DRC engine; the left panel retains
the frozen output from the actual base solver and its two measured 0.050 mm
via-pad violations. This demonstrates successful repair of this fixture, not
completion or DRC results for an entire benchmark dataset.

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
