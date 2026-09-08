import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a detour beside a blocked via preserves both layer anchors", (): void => {
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
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
    },
    {
      connectionName: "c",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -0.5, y: -0.1, z: 1 },
        { x: 0.5, y: -0.1, z: 1 },
      ],
    },
  ]
  const routes = cloneRoutes(input)
  for (let iteration = 0; iteration < 2; iteration += 1) {
    applyDrcErrorForces(
      srj,
      routes,
      [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "a_0",
          center: { x: -0.01, y: 0.05 },
        },
      ],
      new Map([["a_0", 0]]),
      1,
    )
  }

  const route = routes[0]!.route
  expect(route.length).toBeGreaterThan(input[0]!.route.length)
  expect(route[0]).toEqual(input[0]!.route[0])
  expect(route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(routes[1]).toEqual(input[1])
  const viaIndex = route.findIndex(
    (point, index) => route[index + 1]?.z !== point.z,
  )
  expect(viaIndex).toBeGreaterThan(0)
  expect(route[viaIndex]!.x).toBe(route[viaIndex + 1]!.x)
  expect(route[viaIndex]!.y).toBe(route[viaIndex + 1]!.y)
})
