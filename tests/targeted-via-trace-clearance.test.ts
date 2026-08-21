import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("repairs an exact via-trace pair when its reported center is distant", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_1_mst0",
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
      connectionName: "source_net_2_mst0",
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
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: "via_0",
        pcb_trace_id: "source_net_2_mst0_0",
        center: { x: 0, y: 0 },
      },
    ],
    new Map([["source_net_2_mst0_0", 1]]),
    1,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]?.y).toBeCloseTo(1.0575)
  expect(routes[1]?.route[1]?.y).toBeCloseTo(0.7425)
})
