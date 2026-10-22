import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("inspects both complete evaluator errors and enriched force-targeting metadata", () => {
  const before = snapshot([])
  const rawOnly = {
    ...snapshot([]),
    count: 1,
    rawErrors: [
      padError({
        pad: "pad_a",
        clearance: -0.04,
      }),
    ],
  }
  const enrichedOnly = {
    ...snapshot([
      padError({
        pad: "pad_a",
        clearance: 0.07,
        worst_actual_clearance: -0.04,
      }),
    ]),
    rawErrors: [
      padError({
        pad: "pad_a",
        clearance: 0.07,
      }),
    ],
  }

  expect(hasNewTraceObstacleOverlaps(rawOnly, before)).toBe(true)
  expect(hasNewTraceObstacleOverlaps(enrichedOnly, before)).toBe(true)
  expect(hasNewTraceObstacleOverlaps(enrichedOnly, rawOnly)).toBe(false)
})
