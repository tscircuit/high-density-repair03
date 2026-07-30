import { expect, test } from "bun:test"
import {
  getDrcErrorRouteIndexes,
  getRouteDisjointDrcErrorBatch,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

const createPadError = (traceId: string, center: { x: number; y: number }) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_id: traceId,
  pcb_trace_ids: [traceId],
  pcb_obstacle_id: `pad_${traceId}`,
  message: `PCB trace ${traceId} overlaps with pcb_smtpad "pad_${traceId}" (gap: -0.050mm)`,
  center,
})

test("selects a spatially separated set with disjoint route ownership", () => {
  const traceRouteIndexById = new Map([
    ["trace_a", 0],
    ["trace_b", 1],
    ["trace_c", 2],
    ["trace_d", 3],
  ])
  const first = createPadError("trace_a", { x: 0, y: 0 })
  const sameRoute = createPadError("trace_a", { x: 5, y: 0 })
  const separated = createPadError("trace_c", { x: 2, y: 0 })
  const tooClose = createPadError("trace_d", { x: 2.2, y: 0 })

  const batch = getRouteDisjointDrcErrorBatch(
    [first, sameRoute, separated, tooClose],
    traceRouteIndexById,
    1,
  )

  expect(batch.errors).toEqual([first, separated])
  expect(batch.routeIndexes).toEqual([0, 2])
})

test("resolves every explicit trace participant to its owning route", () => {
  const routeIndexes = getDrcErrorRouteIndexes(
    {
      type: "pcb_via_clearance_error",
      pcb_trace_ids: ["trace_a", "trace_b"],
      pcb_via_trace_ids: ["trace_a", "trace_b"],
      pcb_via_ids: ["via_0", "via_1"],
      center: { x: 0, y: 0 },
    },
    new Map([
      ["trace_a", 4],
      ["trace_b", 9],
    ]),
  )

  expect(routeIndexes).toEqual([4, 9])
})
