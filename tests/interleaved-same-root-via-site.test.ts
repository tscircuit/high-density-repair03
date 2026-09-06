import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("shared via moves retain board indexes with other roots interleaved", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const inputRoutes: HighDensityRoute[] = []
  for (const [connectionName, rootConnectionName, x] of [
    ["unrelated", "unrelated", -3],
    ["signal_mst0", "signal", 0],
    ["foreign", "foreign", 0.18],
    ["signal_mst1", "signal", 0],
  ] as const) {
    inputRoutes.push({
      connectionName,
      rootConnectionName,
      route:
        connectionName === "foreign"
          ? [
              { x, y: -1, z: 0 },
              { x, y: 1, z: 0 },
            ]
          : [
              { x: x - 1, y: 0, z: 0 },
              { x, y: 0, z: 0 },
              { x, y: 0, z: 1 },
              { x: x + 1, y: 0, z: 1 },
            ],
      vias: connectionName === "foreign" ? [] : [{ x, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    })
  }
  const routes: HighDensityRoute[] = cloneRoutes(inputRoutes)
  const connMap = new ConnectivityMap({
    signal: ["signal_mst0", "signal_mst1"],
  })
  for (let iteration = 0; iteration < 2; iteration += 1) {
    applyDrcErrorForces(
      srj,
      routes,
      [
        {
          type: "pcb_via_trace_clearance_error",
          pcb_via_id: "via_0",
          pcb_trace_id: "foreign_0",
          center: { x: 0.09, y: 0 },
        },
      ],
      new Map([["foreign_0", 2]]),
      1,
      connMap,
    )
    expect(routes[1]!.route[1]!.x).toBeLessThan(0)
    expect(routes[1]!.route[1]).toEqual(routes[3]!.route[1])
    expect(routes[1]!.route[2]).toEqual(routes[3]!.route[2])
  }
  expect(routes[0]).toEqual(inputRoutes[0])
  for (let index = 1; index < routes.length; index += 1) {
    expect(routes[index]!.route[0]).toEqual(inputRoutes[index]!.route[0])
    expect(routes[index]!.route.at(-1)).toEqual(
      inputRoutes[index]!.route.at(-1),
    )
  }
})
