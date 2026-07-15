import { expect, test } from "bun:test"
import { isBetterDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("ranks DRC severity before issue count", (): void => {
  const traceRouteIndexById = new Map<string, number>()
  const mildClearanceSnapshot: DrcSnapshot = {
    errors: [
      { type: "pcb_trace_error", message: "gap: 0.068mm" },
      { type: "pcb_trace_error", message: "gap: 0.066mm" },
    ],
    count: 2,
    issueScore: 0.066,
    maxIssueSeverity: 0.034,
    traceRouteIndexById,
  }
  const accidentalContactCandidate: DrcSnapshot = {
    errors: [
      {
        type: "pcb_trace_error",
        message: "PCB traces overlap with accidental contact",
      },
    ],
    count: 1,
    issueScore: 1,
    maxIssueSeverity: 1,
    traceRouteIndexById,
  }
  const manyMildClearances: DrcSnapshot = {
    errors: Array.from({ length: 40 }, () => ({
      type: "pcb_trace_error",
      message: "gap: 0.07mm",
    })),
    count: 40,
    issueScore: 1.2,
    maxIssueSeverity: 0.03,
    traceRouteIndexById,
  }

  expect(
    isBetterDrcSnapshot(accidentalContactCandidate, mildClearanceSnapshot),
  ).toBe(false)
  expect(
    isBetterDrcSnapshot(mildClearanceSnapshot, accidentalContactCandidate),
  ).toBe(true)
  expect(
    isBetterDrcSnapshot(accidentalContactCandidate, manyMildClearances),
  ).toBe(false)
  expect(
    isBetterDrcSnapshot(manyMildClearances, accidentalContactCandidate),
  ).toBe(true)
})
