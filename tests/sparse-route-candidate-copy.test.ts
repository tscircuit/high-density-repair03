import { expect, test } from "bun:test"
import {
  cloneRoutesForIndexes,
  materializeRoutesForIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../lib"

test("copies and materializes only affected candidate routes", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route_0",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "route_1",
      route: [
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]

  const candidateRoutes = cloneRoutesForIndexes(routes, [1])
  candidateRoutes[1]!.route = [
    { x: 0.123456789, y: 1.987654321, z: 0 },
    { x: 0.123456789, y: 1.987654321, z: 1 },
    { x: 1, y: 1, z: 1 },
  ]
  const materializedRoutes = materializeRoutesForIndexes(candidateRoutes, [1])

  expect(candidateRoutes[0]).toBe(routes[0])
  expect(candidateRoutes[1]).not.toBe(routes[1])
  expect(routes[1]!.route).toHaveLength(2)
  expect(materializedRoutes[0]).toBe(routes[0])
  expect(materializedRoutes[1]!.vias).toEqual([
    { x: 0.123456789, y: 1.987654321 },
  ])
})
