import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("preserves terminal-aware movement after paired via-trace repair", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "via_owner", pointsToConnect: [] },
      { name: "segment_owner", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "via_owner",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "segment_owner",
      route: [
        { x: -1, y: 0.8, z: 0 },
        { x: 0, y: 0.8, z: 0 },
        { x: 1, y: 0.8, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_trace_error",
        pcb_trace_error_id: "overlap_segment_owner_0_via_1",
        pcb_trace_id: "segment_owner_0",
        pcb_port_ids: ["pcb_port_1"],
        message: 'PCB trace segment_owner_0 is too close to pcb_via "via_1"',
        center: { x: 0, y: 0.9 },
      },
    ],
    new Map([["segment_owner_0", 1]]),
    1,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]?.y).toBeGreaterThan(1.115)
  expect(routes[1]?.route[1]?.y).toBeLessThan(0.685)
})
