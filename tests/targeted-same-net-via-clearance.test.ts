import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("coalesces an explicitly identified overlapping same-net via pair", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_5_mst0", pointsToConnect: [] },
      { name: "source_net_5_mst1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_5_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_5_mst1",
      route: [
        { x: -1, y: 0.05, z: 0 },
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0.05, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["source_net_5_mst0", "source_net_5"],
    ["source_net_5_mst1", "source_net_5"],
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_via_clearance_error",
        error_type: "pcb_via_clearance_error",
        pcb_error_id: "same_net_vias_close_via_0_via_1",
        pcb_via_ids: ["via_0", "via_1"],
        center: { x: 0.025, y: 0 },
      },
    ],
    new Map(),
    1,
    connMap,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]).toMatchObject({ x: 0, y: 0 })
  expect(routes[1]?.route[1]).toMatchObject({ x: 0, y: 0 })
  expect(routes[1]?.route[2]).toMatchObject({ x: 0, y: 0 })
})
