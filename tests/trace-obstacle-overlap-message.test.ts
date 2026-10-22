import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("detects accidental contact from an external evaluator without numeric clearance", () => {
  const before = snapshot([
    padError({
      pad: "pad_a",
      clearance: 0.07,
    }),
    padError({
      pad: "pad_b",
      clearance: 0.04,
    }),
  ])
  const after = snapshot(
    [
      padError({
        pad: "pad_a",
        clearance: 0,
        actual_clearance: undefined,
        message:
          'PCB trace trace_0 overlaps with pcb_smtpad "pad_a" (accidental contact)',
      }),
    ],
    0.01,
  )
  expect(hasNewTraceObstacleOverlaps(after, before)).toBe(true)
})
