import { expect, test } from "bun:test"
import { getDrcInvolvedRouteIndexes } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcInvolvedRouteIndexes"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("via refinement excludes unrelated routes only with complete DRC ownership", () => {
  const errors: Array<Record<string, unknown>> = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "wire_a",
      pcb_trace_ids: ["wire_a", "wire_b"],
    },
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: "pad_trace",
    },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_trace_ids: ["via_owner"],
      pcb_via_ids: ["via_a"],
    },
    {
      type: "pcb_via_clearance_error",
      pcb_trace_ids: ["pair_a", "pair_b"],
      pcb_via_ids: ["via_b", "via_c"],
    },
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: "fixed_trace_outside_repair",
    },
  ]
  const snapshot: DrcSnapshot = {
    errors,
    rawErrors: errors,
    count: errors.length,
    issueScore: 1,
    traceRouteIndexById: new Map(
      [
        "wire_a",
        "wire_b",
        "pad_trace",
        "via_owner",
        "pair_a",
        "pair_b",
        "clean",
      ].map((id, index) => [id, index]),
    ),
  }
  expect(getDrcInvolvedRouteIndexes(snapshot)).toEqual(
    new Set([0, 1, 2, 3, 4, 5]),
  )

  // A legacy trace-pair error identifying only one side cannot justify
  // pruning the other side, and a force-target list can omit raw errors.
  const incomplete = { type: "pcb_trace_error", pcb_trace_id: "wire_a" }
  expect(
    getDrcInvolvedRouteIndexes({
      ...snapshot,
      rawErrors: [incomplete],
      errors: [incomplete],
      count: 1,
    }),
  ).toBeUndefined()
  expect(
    getDrcInvolvedRouteIndexes({ ...snapshot, count: errors.length + 1 }),
  ).toBeUndefined()
  expect(
    getDrcInvolvedRouteIndexes({ ...snapshot, errors: [incomplete] }),
  ).toBeUndefined()
})
