import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"

test("disabled large-board fallback performs no broad-force work", () => {
  const hdRoutes = Array.from({ length: 121 }, (_, index) => ({
    connectionName: `route-${index}`,
    route: [
      { x: index * 2, y: 1, z: 0 },
      { x: index * 2 + 1, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }))
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes,
    effort: 100,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    drcEvaluator: () =>
      Array.from({ length: 20 }, (_, index) => ({
        message: `synthetic unrepairable DRC ${index}`,
        center: { x: index * 2, y: 1 },
      })),
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveBroadForceAttempts).toBe(0)
})
