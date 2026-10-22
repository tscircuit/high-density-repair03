import { expect, test } from "bun:test"
import {
  hasNewTraceObstacleOverlaps,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("still accepts progress on pre-existing overlaps and positive clearances", () => {
  for (const clearance of [-0.04, 0.04]) {
    const before = snapshot([
      padError({
        pad: "pad_a",
        clearance,
      }),
      padError({
        pad: "pad_b",
        clearance: 0.07,
      }),
    ])
    const after = snapshot(
      [
        padError({
          pad: "pad_a",
          clearance: clearance + 0.01,
        }),
      ],
      0.01,
    )

    expect(hasNewTraceObstacleOverlaps(after, before)).toBe(false)
    expect(isDrcSnapshotCountBetter(after, before)).toBe(true)
    expect(
      isBetterDrcSnapshot(after, 0, before.count, before.issueScore, 0, before),
    ).toBe(true)
    expect(isDrcSnapshotCountBetter(snapshot([]), before)).toBe(true)
  }
})
