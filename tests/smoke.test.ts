import { describe, expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"

describe("GlobalDrcForceImproveSolver", () => {
  test("solves in a single step", () => {
    const solver = new GlobalDrcForceImproveSolver({
      srj: {
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        connections: [],
        obstacles: [],
        layerCount: 2,
        minTraceWidth: 0.1,
        minViaDiameter: 0.3,
        defaultObstacleMargin: 0.1,
      },
      hdRoutes: [],
      drcEvaluator: () => [],
    })

    solver.step()

    expect(solver.solved).toBe(true)
  })
})
