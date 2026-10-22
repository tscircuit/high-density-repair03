import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a segment detour refreshes via indices before the same error moves its via", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route0",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0.1, y: 0.2 }],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0.1, y: 0.2, z: 0 },
        { x: 0.1, y: 0.2, z: 1 },
        { x: 2, y: 2, z: 1 },
      ],
    },
  ]
  const originalLength = routes[0]!.route.length
  expect(
    applyDrcErrorForces(
      srj,
      routes,
      [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "trace0",
          center: { x: -0.1, y: 0.1 },
        },
      ],
      new Map([["trace0", 0]]),
      1,
    ),
  ).toBeTrue()
  expect(routes[0]!.route.length).toBe(originalLength + 1)
  const beforeVia = routes[0]!.route[3]!
  const afterVia = routes[0]!.route[4]!
  expect(beforeVia.z).toBe(0)
  expect(afterVia.z).toBe(1)
  expect(beforeVia.x).toBe(afterVia.x)
  expect(beforeVia.y).toBe(afterVia.y)
  expect(beforeVia.x).not.toBe(0.1)
  const [output] = materializeRoutes(routes)
  expect(output!.vias).toEqual([{ x: afterVia.x, y: afterVia.y }])
})
