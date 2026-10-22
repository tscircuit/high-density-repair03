import { expect, test } from "bun:test"
import { createRawOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("final acceptance rejects a new overlap omitted from centered evaluator errors", () => {
  const { solver, hdRoutes, originalRoutes, getOverlapCandidates } =
    createRawOverlapCase()
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getOverlapCandidates()).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(solver.stats.globalDrcForceImproveTraceObstacleRepairRolledBack).toBe(
    true,
  )
  expect(hdRoutes).toEqual(originalRoutes)
})
