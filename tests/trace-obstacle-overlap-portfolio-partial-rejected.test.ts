import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "../lib"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio rejects a mixed candidate that creates another pad contact", () => {
  const { solver: fixtureSolver, originalRoutes } = createBroadOverlapCase({
    rawOnly: true,
    existingOverlap: false,
  })
  const solver = new GlobalDrcBranchPortfolioSolver({
    ...fixtureSolver.params,
    drcEvaluator: ({ routes }) => {
      const movedA = routes?.[0]?.route[1]?.y !== originalRoutes[0]!.route[1]!.y
      const movedB = routes?.[1]?.route[1]?.y !== originalRoutes[1]!.route[1]!.y
      const errors =
        movedA || movedB
          ? [
              {
                type: "pcb_trace_error",
                pcb_trace_id: movedA ? "net_a_0" : "net_b_0",
                pcb_smtpad_id: "foreign_pad",
                actual_clearance: -0.04,
              },
            ]
          : Array.from({ length: 3 }, () => ({ type: "clearance" }))
      return { errors, errorsWithCenters: [] }
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(solver.stats.finalDrcIssueCount).toBe(3)
  expect(solver.stats.drcBranchPortfolioTraceObstacleConnectionsRestored).toBe(
    0,
  )
})
