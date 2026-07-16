import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"

test("large boards still plateau-stop when broad fallback is disabled", () => {
  const hdRoutes = Array.from({ length: 121 }, (_, index) => ({
    connectionName: `route-${index}`,
    route: [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }))
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes,
    effort: 5,
    maxIterations: 160,
    enableLargeBoardBroadFallback: false,
    drcEvaluator: () => [
      {
        message: "synthetic unrepairable DRC",
        center: { x: 1, y: 1 },
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(2)
  expect(solver.stats.globalDrcForceImproveDrcCountPlateauChecks).toBe(2)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
})
