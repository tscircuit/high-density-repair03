import { expect, test } from "bun:test"
import { isBetterDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("fewer via issues cannot justify worse clearance at the same total DRC count", () => {
  const before: DrcSnapshot = {
    count: 1,
    issueScore: 0.01,
    traceRouteIndexById: new Map(),
    errors: [
      { type: "pcb_via_clearance_error", message: "gap: 0.09mm" },
    ],
  }
  const candidate: DrcSnapshot = {
    count: 1,
    issueScore: 0.15,
    traceRouteIndexById: new Map(),
    errors: [
      { type: "pcb_trace_error", message: "gap: -0.05mm" },
    ],
  }

  expect(isBetterDrcSnapshot(candidate, 0, 1, 0.01, 1, before)).toBe(false)
})
