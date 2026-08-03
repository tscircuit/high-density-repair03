import { expect, test } from "bun:test"
import { getIndependentDrcErrorBatch } from "../lib/solvers/GlobalDrcForceImproveSolver/independentDrcErrorBatch"

test("selects a deterministic batch with disjoint routes and influence regions", () => {
  const traceRouteIndexById = new Map([
    ["trace_0", 0],
    ["trace_1", 1],
    ["trace_2", 2],
    ["trace_3", 3],
  ])
  const errors = [
    { pcb_trace_id: "trace_0", center: { x: 0, y: 0 } },
    { pcb_trace_id: "trace_0", center: { x: 4, y: 0 } },
    { pcb_trace_id: "trace_1", center: { x: 0.2, y: 0 } },
    { pcb_trace_id: "trace_2", center: { x: 2, y: 0 } },
    { pcb_trace_id: "trace_3", center: { x: 4, y: 0 } },
  ]

  const selected = getIndependentDrcErrorBatch(errors, traceRouteIndexById)

  expect(selected).toEqual([errors[0]!, errors[3]!, errors[4]!])
})
