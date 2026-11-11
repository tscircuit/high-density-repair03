import { expect, test } from "bun:test"
import { isBetterDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("uses fewer via errors only to break equal count and severity", (): void => {
  const best: DrcSnapshot = {
    errors: [
      { type: "pcb_trace_error", pcb_via_ids: ["via_101"] },
      { type: "pcb_trace_error", pcb_via_ids: ["via_98"] },
    ],
    count: 2,
    issueScore: 0.036401793760900386,
    legacyIssueScore: 0.036401793760900386,
    traceRouteIndexById: new Map(),
  }
  // The native ButterStick waypoint clears a via gap by hitting pad66.
  const worse: DrcSnapshot = {
    ...best,
    errors: [best.errors[0]!, { type: "pcb_trace_error", pcb_pad_id: "pad66" }],
    issueScore: 0.13401556403576204,
    legacyIssueScore: 0.13401556403576204,
  }
  expect(isBetterDrcSnapshot(worse, 1, 2, best.issueScore, 2, best)).toBe(false)
  const tied = {
    ...worse,
    issueScore: best.issueScore,
    legacyIssueScore: best.issueScore,
  }
  expect(isBetterDrcSnapshot(tied, 1, 2, best.issueScore, 2, best)).toBe(true)
  const fewer = { ...worse, errors: worse.errors.slice(1), count: 1 }
  expect(isBetterDrcSnapshot(fewer, 0, 2, best.issueScore, 2, best)).toBe(true)
  expect(isBetterDrcSnapshot(best, 2, 2, worse.issueScore, 1, worse)).toBe(true)
})
