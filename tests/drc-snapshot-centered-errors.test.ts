import { expect, test } from "bun:test"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { SimpleRouteJson } from "../lib/types"

test("external DRC snapshots preserve location-aware errors", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
  }

  const snapshot = getDrcSnapshot(srj, [], () => ({
    errors: [{ type: "pcb_via_trace_clearance_error" }],
    errorsWithCenters: [
      {
        type: "pcb_via_trace_clearance_error",
        center: { x: 0.25, y: -0.5 },
      },
    ],
  }))

  expect(snapshot.count).toBe(1)
  expect(snapshot.errors).toEqual([
    {
      type: "pcb_via_trace_clearance_error",
      center: { x: 0.25, y: -0.5 },
    },
  ])
})
