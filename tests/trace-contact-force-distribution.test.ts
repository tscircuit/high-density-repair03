import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

test("trace-pair forces account for contact interpolation weights", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: ["a", "b"].map((name) => ({ name, pointsToConnect: [] })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "a",
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "b",
      route: [
        { x: 0, y: 0.18, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const routes = cloneRoutes(input)
  const before = getDrcSnapshot(srj, routes)
  expect(before.count).toBe(1)

  applyDrcErrorForces(
    srj,
    routes,
    before.errors,
    new Map([
      ["a_0", 0],
      ["b_0", 1],
    ]),
    1,
  )

  // The old half-displacement rule left a 0.08875 mm gap at this contact.
  expect(getDrcSnapshot(srj, routes).count).toBe(0)
  for (let index = 0; index < routes.length; index += 1) {
    expect(routes[index]!.route[0]).toEqual(input[index]!.route[0])
    expect(routes[index]!.route.at(-1)).toEqual(input[index]!.route.at(-1))
  }
})
