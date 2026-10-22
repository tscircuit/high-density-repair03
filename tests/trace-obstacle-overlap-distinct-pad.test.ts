import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("detects trading an existing overlap for an overlap on another pad", () => {
  const before = snapshot([
    padError({
      pad: "pad_a",
      clearance: -0.04,
    }),
    padError({
      pad: "pad_b",
      clearance: 0.07,
    }),
  ])
  const after = snapshot(
    [
      padError({
        pad: "pad_b",
        clearance: -0.01,
      }),
    ],
    0.01,
  )

  expect(hasNewTraceObstacleOverlaps(after, before)).toBe(true)
})
