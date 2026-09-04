import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPointToObstacleDistance } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("an existing copper overlap can improve without grandfathering a newly created via", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "own-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.7,
        layers: ["top"],
        connectedTo: ["own-net"],
      },
      {
        type: "rect",
        center: { x: 0.85, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["foreign-net"],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "own-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.45, y: 0, z: 0 },
      { x: 0.45, y: 0, z: 1 },
      { x: -1, y: 1, z: 1 },
    ],
    vias: [{ x: 0.45, y: 0 }],
  }
  const routes = [route]
  const input = structuredClone(routes)
  const oldDistance = getPointToObstacleDistance(
    route.vias[0]!,
    srj.obstacles[0]!,
  )
  const output = applyViaToPadClearanceRelaxation(srj, routes, undefined, 0)
  const newDistance = getPointToObstacleDistance(
    output[0]!.vias[0]!,
    srj.obstacles[0]!,
  )
  expect(newDistance).toBeGreaterThan(oldDistance)
  expect(newDistance).toBeLessThan(route.viaDiameter / 2)

  // Identical provisional geometry has no overlap allowance when the via
  // was introduced by a layer change. Its incomplete placement is rejected.
  const previousRoute: HighDensityRoute = {
    ...route,
    route: route.route.map((point) => ({ ...point, z: 0 })),
    vias: [],
  }
  expect(
    applyViaToPadClearanceRelaxation(srj, routes, undefined, 0, [
      previousRoute,
    ]),
  ).toBe(routes)

  // The allowance is the old signed copper gap, not just the old center
  // distance. A larger via must not deepen that overlap after a size change.
  const enlargedRoutes = [{ ...route, viaDiameter: 0.4 }]
  expect(
    applyViaToPadClearanceRelaxation(srj, enlargedRoutes, undefined, 0, routes),
  ).toBe(enlargedRoutes)
  expect(routes).toEqual(input)
})
