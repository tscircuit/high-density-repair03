import { expect, test } from "bun:test"
import {
  getLegacyFirstRepairErrors,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  DrcSnapshot,
  PcbTraceId,
} from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("repairs forbidden drills first and rejects trading clear copper for a drill", (): void => {
  const drill = {
    type: "pcb_placement_error",
    pcb_via_ids: ["via_0"],
    pcb_pad_ids: ["via_0", "pcb_smtpad_A"],
  }
  const copper = { type: "pcb_trace_error" }
  expect(getLegacyFirstRepairErrors([copper, drill])).toEqual([drill])
  const best: DrcSnapshot = {
    errors: [copper, copper],
    count: 2,
    issueScore: 2,
    traceRouteIndexById: new Map<PcbTraceId, number>(),
  }
  const candidate: DrcSnapshot = {
    ...best,
    errors: [drill],
    count: 1,
    issueScore: 0.01,
  }
  expect(isDrcSnapshotCountBetter(candidate, best)).toBe(false)
  expect(isBetterDrcSnapshot(candidate, 0, 2, 2, 0, best)).toBe(false)
  expect(getLegacyFirstRepairErrors([copper])).toEqual([copper])
})
