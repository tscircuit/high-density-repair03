# Shared ground via remains too close to a foreign pad

## Reproduce

```sh
bun install --no-save
bun test tests/shared-via-pad-clearance.test.ts
```

The repro test deliberately asserts the observed failure, so it passes on the
repro branch. It runs the real repair solver with two same-root routes sharing
one through-via beside an unrelated rectangular pad. No mocked DRC is used.

![Measured repair output](../../tests/__snapshots__/shared-via-pad-clearance.snap.svg)

## Expected and actual

The 0.60 mm via must have at least 0.10 mm copper clearance from the
0.95 × 0.80 mm pad. Both ground routes must remain attached to the same via,
and their terminal positions must stay fixed.

On baseline `4987f52e782102e31c4bff7dc49fccb3a258a887`, the solver finishes
with one DRC error and leaves a 0.000001 mm copper gap. The numeric geometry
assertion independently verifies the defect. The two route representations
remain colocated, but the via does not move away from the pad.

The dark circle is the via copper, the gray rectangle is the foreign pad,
and the purple marker indicates the detected clearance error. Red and blue
segments are top- and bottom-layer copper. This is an actual solver render;
schematic output is unaffected by this repair-only change.

## Origin and reduction

This was found on a 90 × 55 mm STM32F407VGT6 board with a 16-bit LCD bus and
three explicit autorouting phases: LCD bus lanes, support/power, and MCU data
fanout. The support phase used `beta_pipeline7`. All three original cold builds
using tscircuit 0.0.2764 / capacity-autorouter 0.0.958 left a ground via at
(-30.775001, 13.841451906949) mm beside C12.pin1 on VCAP_2, centered at
(-30, 13.675) mm. Full-board DRC rejected that result.

The same location reproduces when replaying the captured support-phase input
on autorouter commit `9336cd949fb478669628d74620bfc4135c9ff087`. Two point-pair
routes share this physical via. The reduced test translates C12 to the origin,
preserves the measured pad/via geometry, and replaces the long ground routes
with four short legs. Phase scheduling and the LCD bus are not needed to
trigger the isolated repair failure; their geometry is intentionally omitted.

## Cause

The via-to-pad error path in `applyDrcErrorForces` calls
`moveViaAwayFromPoint`, which calls `moveVia`. That helper rejects any site
where `getSameRootViaSite(...).length > 1`. Moving only one representation
would disconnect the shared via, but refusing to move either leaves a
repairable clearance error unresolved. The existing
`translateSameRootViaSite` helper already moves all representations together
and rejects a site containing an immovable member.

The full-board bitmap short report is resolution-dependent: the original
geometric gap is positive, not an overlap. The failing 0.10 mm clearance rule
is sufficient evidence of the bug.
