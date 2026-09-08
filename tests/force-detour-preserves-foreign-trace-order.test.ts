import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a detour between fixed endpoints cannot cross a foreign trace", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "left" },
        { x: 1, y: 0, z: 0, pcb_port_id: "right" },
      ],
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -0.5, y: -0.1, z: 0 },
        { x: 0.5, y: -0.1, z: 0 },
      ],
    },
  ]
  const routes = cloneRoutes(input)
  applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_trace_error",
        pcb_trace_id: "a_0",
        center: { x: 0, y: 0.05 },
      },
    ],
    new Map([["a_0", 0]]),
    1,
  )

  const route = routes[0]!.route
  expect(route[0]).toEqual(input[0]!.route[0])
  expect(route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(routes[1]).toEqual(input[1])
  // Copper starts touching. A detour may not reduce this separation or create
  // a crossing, even though the original two vertices cannot move.
  for (const point of route) expect(point.y).toBeGreaterThanOrEqual(-0.000002)
  for (const point of route.slice(1, -1)) {
    expect(point.pcb_port_id).toBeUndefined()
  }
})
