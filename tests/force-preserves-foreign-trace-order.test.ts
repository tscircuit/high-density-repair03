import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

test("a targeted force cannot tunnel through an unrelated trace", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: ["a", "b", "c"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "a",
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
      connectionName: "b",
      route: [
        { x: -1, y: 0.1, z: 0 },
        { x: 0, y: 0.1, z: 0 },
        { x: 1, y: 0.1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "c",
      route: [
        { x: -0.4, y: -0.105, z: 0 },
        { x: 0.4, y: -0.105, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const routes = cloneRoutes(input)
  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_trace_error",
        pcb_trace_id: "a_0",
        pcb_trace_error_id: "overlap_a_0_b_0",
        center: { x: 0, y: 0.05 },
      },
    ],
    new Map([
      ["a_0", 0],
      ["b_0", 1],
      ["c_0", 2],
    ]),
    1,
  )

  expect(changed).toBe(true)
  // The old force moved this vertex to -0.14, crossing the fixed third trace.
  expect(routes[0]!.route[1]!.y).toBeGreaterThanOrEqual(-0.005002)
  expect(routes[0]!.route[1]!.y).toBeLessThan(0)
  expect(routes[2]).toEqual(input[2])
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    expect(routes[routeIndex]!.route[0]).toEqual(input[routeIndex]!.route[0])
    expect(routes[routeIndex]!.route.at(-1)).toEqual(
      input[routeIndex]!.route.at(-1),
    )
  }
})
