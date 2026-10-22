import { expect, test } from "bun:test"
import {
  hasNewTraceObstacleOverlaps,
  isBetterDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("keeps an existing pad overlap eligible for same-count clearance improvement", () => {
  const before = snapshot(
    [
      padError({
        pad: "pad_a",
        clearance: -0.04,
      }),
    ],
    0.14,
  )
  const after = snapshot(
    [
      padError({
        pad: "pad_a",
        clearance: -0.01,
      }),
    ],
    0.11,
  )

  expect(hasNewTraceObstacleOverlaps(after, before)).toBe(false)
  expect(
    isBetterDrcSnapshot(after, 0, before.count, before.issueScore, 0, before),
  ).toBe(true)
})
