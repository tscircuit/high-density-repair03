# RV1106 phased routing repair

The 50 × 50 mm, four-layer RV1106 board uses Pipeline9 with explicit clocks,
boot-flash, and remaining autorouting phases. Components are on top. The
schematic uses schematic sections and automatic layout without schX/schY.

`autorouting-phases.json.gz` contains the original three phase inputs and the
completed clock/flash outputs. Clock routing produces 11 traces; flash routing
receives those and produces 21 cumulative traces. The remaining phase receives
all 21 traces and has 36 connections. `clocks.png` and `boot-flash.png` preserve
the completed phase views.

`full-board.json.gz` is the real combined high-density route geometry at the
end of Pipeline9 joint repair, captured from a replay of the RV1106 routing
checkpoint. The replay reproduced the original final trace output exactly.
It includes 218 new routes, 20 movable earlier-phase routes, fixed-copper
obstacles, the board obstacles, and the connectivity map. It does not rerun
TinyHypergraph or claim that the entire board is DRC-clean.

The capture used tscircuit-autorouter commit
`4f5522e4a30fd16b4e5043a95918593b795f5517`, with the TinyHypergraph owner-search
change from PR #181 during the original path search. The existing repair
repro/fix are tscircuit-autorouter PRs #2515 and #2516.

The original Pipeline9 output has 36 relaxed-reference DRC reports. This
repair03 repro independently checks the captured combined HD geometry with
its native engine, including via-to-pad checks, and starts with 147 reports.
These are different validation scopes; 147 must not be presented as the
original board's 36-report count.

The direction repro runs the existing three force candidates for one actual
same-net via pair. The full-board and detail SVG paths are refreshed in the
stacked fix, while the captured input remains unchanged. The detail filters
the native visualizer to nearby via circles and local segments; the full view
retains all routing geometry.

Run `bun test tests/rv1106-via-merge-direction.test.ts`. Set
`BUN_UPDATE_SNAPSHOTS=1` to refresh its two native SVG snapshots.
