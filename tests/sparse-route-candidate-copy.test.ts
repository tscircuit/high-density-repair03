import { expect, test } from "bun:test"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutesForIndexes,
  getForceMoveGuard,
  materializeRoutesForIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

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

test("sparse topology candidates retain fixed-copper legality without a force index", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
  }
  const moving: HighDensityRoute = {
    connectionName: "moving",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const crossing: HighDensityRoute = {
    ...moving,
    connectionName: "fixed",
    route: [
      { x: 0, y: -1, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
  }
  for (const [fixed, expected] of [
    [crossing, false],
    [{ ...crossing, connectionName: "moving" }, true],
    [
      {
        ...crossing,
        route: crossing.route.map((point) => ({ ...point, z: 2 })),
      },
      true,
    ],
    [
      {
        ...crossing,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 3 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      false,
    ],
  ] satisfies [HighDensityRoute, boolean][]) {
    const input = [structuredClone(moving)]
    const fixedRoutes = [structuredClone(fixed)]
    const before = structuredClone({ input, fixedRoutes })
    const eager = cloneRoutesForIndexes(input, [0])
    getForceMoveGuard(eager, undefined, srj, fixedRoutes)
    const sparse = cloneRoutesForIndexes(input, [0])
    const evaluate = (routes: HighDensityRoute[]) =>
      applySafeTraceLayerMoveForError(
        srj,
        routes,
        { type: "pcb_trace_error", center: { x: 0, y: 0 } },
        0,
        1,
        0,
        undefined,
        0,
        false,
        fixedRoutes,
      )
    expect(evaluate(eager)).toBe(expected)
    expect(evaluate(sparse)).toBe(expected)
    expect(sparse).toEqual(eager)
    expect({ input, fixedRoutes }).toEqual(before)
  }
})
