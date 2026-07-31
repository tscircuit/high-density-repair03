import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("separates the exact trace pair encoded by a checks error id", () => {
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
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: -1, y: 0.1, z: 0 },
        { x: 0, y: 0.1, z: 0 },
        { x: 1, y: 0.1, z: 0 },
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
        error_type: "pcb_trace_error",
        pcb_trace_id: "source_net_1_mst0_0",
        pcb_trace_error_id: "overlap_source_net_1_mst0_0_source_net_2_mst0_0",
        center: { x: 0, y: 0.05 },
      },
    ],
    new Map([
      ["source_net_1_mst0_0", 0],
      ["source_net_2_mst0_0", 1],
    ]),
    1,
  )

  expect(changed).toBe(true)
  const lowestLeftY = Math.min(...routes[0]!.route.map((point) => point.y))
  const highestRightY = Math.max(...routes[1]!.route.map((point) => point.y))
  expect(lowestLeftY).toBeLessThan(0)
  expect(highestRightY - lowestLeftY).toBeGreaterThan(0.1)
})
