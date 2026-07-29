import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("allows plateau stopping for explicitly bounded large-board repair", () => {
  const hdRoutes: HighDensityRoute[] = Array.from(
    { length: 121 },
    (_, index) => ({
      connectionName: `route_${index}`,
      route: [
        { x: 0, y: index, z: 0 },
        { x: 10, y: index, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 121 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 32,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: () =>
      Array.from({ length: 36 }, (_, index) => ({
        message: `synthetic centered DRC ${index}`,
        center: { x: index, y: 5 },
      })),
  })

  for (let index = 0; index < 15; index += 1) {
    solver.step()
    expect(solver.solved).toBe(false)
  }
  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(16)
  expect(solver.stats.globalDrcForceImproveDrcCountPlateauChecks).toBe(2)
})
