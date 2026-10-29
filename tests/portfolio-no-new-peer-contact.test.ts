import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "../lib"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("the broad portfolio compares peer contacts against the original input", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const before = getPhysicalPeerPairs(hdRoutes)
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    maxIterations: 1,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(true)
  expect(solver.stats.drcBranchPortfolioPeerTraceRepairRolledBack).toBe(true)
  expect(solver.stats.finalDrcIssueCount).toBeLessThanOrEqual(5)
  expect(
    getPhysicalPeerPairs(solver.getOutput()).filter(
      (pair) => !before.includes(pair),
    ),
  ).toEqual([])
  expect(
    solver.stats.drcBranchPortfolioOverlapRestorationChecks,
  ).toBeLessThanOrEqual(2)
})
