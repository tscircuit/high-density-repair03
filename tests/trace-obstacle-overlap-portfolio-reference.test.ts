import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver, type HighDensityRoute } from "../lib"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio checks reference DRC and reports statistics after overlap rollback", () => {
  const {
    solver: fixture,
    originalRoutes,
    getOverlapCandidates,
  } = createBroadOverlapCase(true, false)
  const referenceInputs: HighDensityRoute[][] = []
  const solver = new GlobalDrcBranchPortfolioSolver({
    ...fixture.params,
    referenceDrcEvaluator: ({ routes }) => {
      referenceInputs.push(structuredClone(routes!))
      return []
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getOverlapCandidates()).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(referenceInputs).toEqual([originalRoutes, originalRoutes])
  expect(solver.stats.finalDrcIssueCount).toBe(3)
  expect(solver.stats.drcBranchPortfolioTraceObstacleRepairRolledBack).toBe(
    true,
  )
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
  expect(solver.stats.drcBranchPortfolioReferenceCandidateDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioReferenceCandidateRolledBack).toBe(
    false,
  )
})
