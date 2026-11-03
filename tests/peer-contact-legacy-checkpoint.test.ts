import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("an evaluator that reports only via debt cannot admit a peer short as a legacy-clean checkpoint", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: ({ routes }) =>
      routes![0]!.route[1]!.y === 0.8
        ? [{ type: "pcb_pad_pad_clearance_error", pcb_via_ids: ["via_1"] }]
        : Array.from({ length: 3 }, () => ({ type: "clearance" })),
  })
  solver.step()
  const state = solver as unknown as {
    outputSnapshot?: DrcSnapshot
    legacyCleanCheckpoint?: unknown
  }
  expect(state.legacyCleanCheckpoint).toBeUndefined()
  solver.outputHdRoutes = structuredClone(hdRoutes)
  solver.outputHdRoutes[0]!.route[1]!.y = 0.8
  delete state.outputSnapshot
  solver.solved = false
  solver.step()
  expect(state.legacyCleanCheckpoint).toBeUndefined()
  const inputContacts = new Set(getPhysicalPeerPairs(hdRoutes))
  expect(
    getPhysicalPeerPairs(solver.getOutput()).filter(
      (pair) => !inputContacts.has(pair),
    ),
  ).toEqual([])
  expect(solver.stats.finalDrcIssueCount).toBeLessThanOrEqual(3)
})
