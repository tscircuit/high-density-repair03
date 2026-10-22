import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver, type HighDensityRoute } from "../lib"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio keeps independent repairs and reference-checks the mixed candidate", () => {
  const { solver: fixtureSolver, originalRoutes } = createBroadOverlapCase({
    rawOnly: true,
    existingOverlap: false,
  })
  const referenceRoutes: Array<HighDensityRoute[] | undefined> = []
  const solver = new GlobalDrcBranchPortfolioSolver({
    ...fixtureSolver.params,
    drcEvaluator: ({ routes }) => {
      const errors: Record<string, unknown>[] = []
      if (routes?.[0]?.route[1]?.y !== originalRoutes[0]!.route[1]!.y) {
        errors.push({
          type: "pcb_trace_error",
          pcb_trace_id: "net_a_0",
          pcb_smtpad_id: "foreign_pad",
          actual_clearance: -0.04,
        })
      }
      if (routes?.[1]?.route[1]?.y === originalRoutes[1]!.route[1]!.y) {
        errors.push(...Array.from({ length: 3 }, () => ({ type: "clearance" })))
      }
      return { errors, errorsWithCenters: [] }
    },
    referenceDrcEvaluator: ({ routes }) => {
      referenceRoutes.push(structuredClone(routes))
      return []
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()[0]).toEqual(originalRoutes[0])
  expect(solver.getOutput()[1]).not.toEqual(originalRoutes[1])
  expect(referenceRoutes.at(-1)).toEqual(solver.getOutput())
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioTraceObstacleConnectionsRestored).toBe(
    1,
  )
})
