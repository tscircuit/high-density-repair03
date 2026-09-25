import { expect, test } from "bun:test"
import {
  cloneRoutes,
  collectViaNodes,
  moveVia,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("via translation uses its current route position after an attached trace moves", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [],
  }
  const routes = cloneRoutes([
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
        { x: 2, y: 0, z: 2 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
  ])
  const via = collectViaNodes(routes, srj)[0]!
  const route = routes[0]!

  // Trace forces act on the canonical route points within the same sweep.
  route.route[1]!.x += 0.25
  route.route[2]!.x += 0.25
  expect(via.x).toBe(0)

  expect(moveVia(routes, via, 0.1, 0, srj)).toBe(true)
  expect(via.x).toBeCloseTo(0.35)
  expect(route.route[1]).toEqual({ x: via.x, y: 0, z: 0 })
  expect(route.route[2]).toEqual({ x: via.x, y: 0, z: 2 })
  expect(route.route[0]).toEqual({ x: -2, y: 0, z: 0 })
  expect(route.route[3]).toEqual({ x: 2, y: 0, z: 2 })
  expect(route.traceThickness).toBe(0.1)
  expect(route.viaDiameter).toBe(0.3)
})
