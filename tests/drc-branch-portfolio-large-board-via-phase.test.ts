import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("runs the bounded via-in-pad phase on large high-error boards", () => {
  const hdRoutes: HighDensityRoute[] = Array.from(
    { length: 121 },
    (_, index) => ({
      connectionName: `route_${index}`,
      route: [
        { x: 1, y: index + 1, z: 0 },
        { x: 9, y: index + 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 123 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const errors = Array.from({ length: 4 }, (_, index) => ({
    type: "pcb_trace_error",
    message: `externally constrained violation ${index}`,
  }))
  const drcEvaluator: DrcEvaluator = () => errors
  let viaInPadEvaluationCount = 0
  const viaInPadDrcEvaluator: DrcEvaluator = () => {
    viaInPadEvaluationCount += 1
    return errors
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    viaInPadDrcEvaluator,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: true,
    viaInPadMaxIterations: 2,
    broadMaxIterations: 2,
    broadPassMultiplier: 1,
  })

  solver.solve()

  expect(viaInPadEvaluationCount).toBe(2)
  expect(solver.stats.drcBranchPortfolioViaInPadPhaseAttempted).toBe(true)
})
