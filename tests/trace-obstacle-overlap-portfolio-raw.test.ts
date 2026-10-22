import { expect, test } from "bun:test"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio rejects new broad overlaps against original input with raw-only errors", () => {
  const { solver, hdRoutes, originalRoutes, getOverlapCandidates } =
    createBroadOverlapCase({
      rawOnly: true,
      existingOverlap: false,
    })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getOverlapCandidates()).toBeGreaterThan(0)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(true)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(hdRoutes).toEqual(originalRoutes)
})
