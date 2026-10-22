import { expect, test } from "bun:test"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio preserves progress on an existing overlap", () => {
  const { solver, hdRoutes, originalRoutes, getOverlapCandidates } =
    createBroadOverlapCase({
      rawOnly: true,
      existingOverlap: true,
    })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getOverlapCandidates()).toBeGreaterThan(0)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(true)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(true)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
  expect(solver.getOutput()).not.toEqual(originalRoutes)
  expect(hdRoutes).toEqual(originalRoutes)
})
