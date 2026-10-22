import { expect, test } from "bun:test"
import { createBroadOverlapCase } from "./fixtures/traceObstacleOutputGuardFixtures"

test("portfolio rejects metadata-only pad contacts in raw and targeted errors", () => {
  for (const rawOnly of [true, false]) {
    const { solver, originalRoutes, getOverlapCandidates } =
      createBroadOverlapCase({
        rawOnly,
        existingOverlap: false,
        overlapError: {
          type: "pcb_trace_error",
          pcb_trace_id: "net_a_0",
          pcb_smtpad_id: "foreign_pad",
          actual_clearance: -0.04,
          message: "(accidental contact)",
        },
      })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(getOverlapCandidates()).toBeGreaterThan(0)
    expect(solver.getOutput()).toEqual(originalRoutes)
    expect(solver.stats.finalDrcIssueCount).toBe(3)
    expect(solver.stats.drcBranchPortfolioTraceObstacleRepairRolledBack).toBe(
      true,
    )
  }
})
