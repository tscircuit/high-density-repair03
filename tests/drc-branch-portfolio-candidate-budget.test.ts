import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("shares the candidate evaluation budget across portfolio branches", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 7 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 5 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["different_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 5, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 10, y: 5, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  let drcEvaluationCount = 0
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    maxIterations: 32,
    maxCandidateEvaluations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
    drcEvaluator: () => {
      drcEvaluationCount += 1
      return [
        {
          type: "pcb_trace_error",
          message: "pcb_trace overlaps pcb_smtpad",
          center: { x: 2, y: 5 },
          pcb_trace_id: "A_0",
        },
      ]
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(drcEvaluationCount).toBe(3)
  expect(solver.stats.drcBranchPortfolioCandidateEvaluations).toBe(2)
  expect(
    solver.stats.drcBranchPortfolioCandidateEvaluationBudgetExhausted,
  ).toBe(true)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
})
