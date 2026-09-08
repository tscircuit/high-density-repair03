# USB-C terminal-via clearance reproduction

This is a real TSX USB-C power-input circuit, reduced from the T113-S3 board's
USB front end. It connects a TYPE-C-31-M-12 receptacle to an MF-MSMF150-2 fuse,
two 5.1 kΩ CC resistors, and a 22 µF capacitor. The connector and fuse retain
their imported JLCPCB footprints (C165948 and C89648), including the connector's
polygon pads, mechanical holes, plated slots, and silkscreen. Data contacts are
intentionally unused in this power-only fixture.

All six routing phases run Pipeline 9 from real core-generated connections.
There are no supplied routes, fake obstacles, mocked DRC results, custom SVGs,
or edits to the emitted circuit JSON. The snapshot is exactly
`convertCircuitJsonToPcbSvg(circuit.getCircuitJson())`.

## Run

From the repository root:

```sh
bun install
bun install --cwd tests/fixtures/usb-terminal-clearance
bun test tests/usb-terminal-via-clearance.test.ts
bun run typecheck
```

To regenerate only this snapshot:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/usb-terminal-via-clearance.test.ts
```

## Local solver integration

The published capacity-autorouter bundle embeds its repair03 dependency.
`LocalRepairAutorouter` injects this checkout's `GlobalDrcBranchPortfolioSolver`
at the joint-repair stage, before its first step. The original solver parameters,
actual routes, obstacles, and indexed/reference DRC evaluators are unchanged.
Pipeline 9 finishes the routing, and core inserts its output normally. The test
asserts that the local solver ran and accepted a safe terminal layer move, while
the explicit via-in-pad operation remained disabled.

The fixture has an isolated package because current core needs newer peer
dependencies than repair03's existing tests. The child process prevents those
versions from contaminating the parent test runner. Its separate typecheck keeps
strict mode but disables `noUncheckedIndexedAccess`, which the pinned core's
source-distributed fanout dependency does not support. The library and all other
tests retain the repository's original strict compiler settings.

## Defect and scope

While routing CC2, joint repair moves the existing USB VBUS B connection to an
inner layer. It inserts a via next to the connector terminal and another next to
fuse pin 1. Both have only about 0.000001 mm copper-edge clearance, despite the
explicit 0.1 mm rule. The test measures the native polygon/rectangle pad outlines
against the final native via lands and verifies that terminal coordinates and
PCB-port identities are preserved.

The fix includes the configured via-edge clearance in both the terminal escape
search and its final acceptance check. The final native connector and fuse
clearances are now approximately 0.100001 mm. A second regression reuses the
same real circuit's repair input and actual DRC error to cover the default,
zero, non-default, and large clearances, diagonal escapes, and board-boundary
rejection. It does not supply hand-authored traces or fabricated DRC errors.

This repro isolates terminal escape placement. It is not a fabrication-ready
USB product or a claim that every Pipeline 9 DRC problem is solved: the original
wide VBUS trace also has a separate connector mechanical-hole contact, and other
repair paths may move same-net vias again. Those are not hidden or filtered from
the native circuit output.
