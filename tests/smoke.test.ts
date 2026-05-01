import { describe, expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

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
