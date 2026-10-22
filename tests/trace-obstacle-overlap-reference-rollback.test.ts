import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type HighDensityRoute } from "../lib"
import { createRawOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("reference DRC and final statistics use the routes restored after overlap rollback", () => {
  const referenceInputs: HighDensityRoute[][] = []
  const { solver, originalRoutes, drcEvaluator, getOverlapCandidates } =
    createRawOverlapCase(({ routes }) => {
      referenceInputs.push(structuredClone(routes!))
      return routes!.some((route) => route.route.length > 2)
        ? [{ type: "pcb_trace_error", message: "rejected candidate" }]
        : []
    })

  solver.solve()

  expect(getOverlapCandidates()).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(referenceInputs).toHaveLength(2)
  for (const routes of referenceInputs) {
    expect(routes).toEqual(solver.getOutput())
  }
  const result = drcEvaluator({ traces: [], routes: solver.getOutput() })
  const errors = Array.isArray(result) ? result : result.errors
  expect(solver.stats.finalDrcIssueCount).toBe(errors.length)
  expect(
    solver.stats.globalDrcForceImproveReferenceCandidateDrcIssueCount,
  ).toBe(0)
  expect(solver.stats.globalDrcForceImproveTraceObstacleRepairRolledBack).toBe(
    true,
  )
  expect(solver.stats.globalDrcForceImproveReferenceCandidateRolledBack).toBe(
    false,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const clean = new GlobalDrcForceImproveSolver({
    ...solver.getConstructorParams()[0],
    drcEvaluator: () => [],
    referenceDrcEvaluator: undefined,
  })
  clean.solve()
  // This solver inherits BaseSolver's default progress; rollback preserves
  // that existing behavior, while solved/finalDrcIssueCount report completion.
  expect(solver.progress).toBe(clean.progress)
})
