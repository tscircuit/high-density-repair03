import { expect, test } from "bun:test"
import {
  getRepairDrcIssueCount,
  getRepairDrcIssueScore,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("a repair cannot increase total DRCs by replacing trace errors with pad errors", () => {
  const before: DrcSnapshot = {
    count: 2,
    issueScore: 2,
    traceRouteIndexById: new Map(),
    errors: [
      { type: "pcb_trace_error" },
      { type: "pcb_trace_error" },
    ],
  }
  const candidate: DrcSnapshot = {
    count: 3,
    issueScore: 3,
    traceRouteIndexById: new Map(),
    errors: [
      { type: "pcb_trace_error" },
      { type: "pcb_pad_pad_clearance_error", pcb_via_ids: ["via_a"] },
      { type: "pcb_pad_pad_clearance_error", pcb_via_ids: ["via_b"] },
    ],
  }

  expect(isDrcSnapshotCountBetter(candidate, before)).toBe(false)
  expect(
    isBetterDrcSnapshot(
      candidate,
      getViaDrcIssueCount(candidate),
      getRepairDrcIssueCount(before),
      getRepairDrcIssueScore(before),
      getViaDrcIssueCount(before),
      before,
    ),
  ).toBe(false)
})
