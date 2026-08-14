import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("can skip speculative broad-force candidates", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [5, 5.02].map((y, index) => ({
    connectionName: `route_${index}`,
    route: [
      { x: 1, y, z: 0 },
      { x: 3, y, z: 0 },
      { x: 7, y, z: 0 },
      { x: 9, y, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }))

  const runSolver = (enableBroadFallback?: boolean) => {
    let evaluationCount = 0
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes,
      maxIterations: 1,
      enableBroadFallback,
      enablePostSolveClearanceRelaxation: false,
      drcEvaluator: () => {
        evaluationCount += 1
        return [
          {
            type: "pcb_trace_error",
            message: "synthetic centered DRC",
            center: { x: 5, y: 5.01 },
          },
        ]
      },
    })

    solver.solve()
    return { solver, evaluationCount }
  }

  const defaultBehavior = runSolver()
  const enabled = runSolver(true)
  const disabled = runSolver(false)

  expect(defaultBehavior.evaluationCount).toBe(enabled.evaluationCount)
  expect(disabled.evaluationCount).toBeLessThan(enabled.evaluationCount)
  expect(disabled.solver.getOutput()).toEqual(enabled.solver.getOutput())
  expect(disabled.solver.getConstructorParams()[0].enableBroadFallback).toBe(
    false,
  )
})
