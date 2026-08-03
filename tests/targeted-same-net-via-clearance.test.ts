import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc"
import { GlobalDrcForceImproveSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("canonicalizes an untagged same-net transition endpoint", () => {
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
  const inputHdRoutes = [
    {
      connectionName: "source_net_5_mst0",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_5_mst1",
      route: [
        { x: 0.05, y: 0, z: 0, pcb_port_id: "pcb_port_fixed" },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const routes = cloneRoutes(inputHdRoutes)
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
  expect(routes[0]?.route[0]?.x).toBe(0.05)
  expect(routes[0]?.route[1]?.x).toBe(0.05)
  expect(routes[1]?.route[0]?.x).toBe(0.05)
  expect(routes[1]?.route[1]?.x).toBe(0.05)
  expect(routes[1]?.route[0]?.pcb_port_id).toBe("pcb_port_fixed")

  const drcEngine = new AutoroutingDrcEngine(srj, { connMap })
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputHdRoutes,
    connMap,
    autoroutingDrcEngine: drcEngine,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  expect(
    getDrcSnapshot(srj, inputHdRoutes, undefined, connMap, drcEngine).count,
  ).toBe(1)
  solver.solve()
  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, connMap, drcEngine)
      .count,
  ).toBe(0)
})
