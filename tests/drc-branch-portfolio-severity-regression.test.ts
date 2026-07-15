import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("keeps a lower-severity baseline with more errors", (): void => {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 1, y: 5, z: 0 },
        { x: 3, y: 5, z: 0 },
        { x: 7, y: 5, z: 0 },
        { x: 9, y: 5, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "B",
      route: [
        { x: 1, y: 5.02, z: 0 },
        { x: 3, y: 5.02, z: 0 },
        { x: 7, y: 5.02, z: 0 },
        { x: 9, y: 5.02, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [
      { name: "A", pointsToConnect: [] },
      { name: "B", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const leftPoint = routes?.[0]?.route[1]
    const rightPoint = routes?.[1]?.route[1]
    if (!leftPoint || !rightPoint) {
      throw new Error("DRC evaluator requires both test routes")
    }
    const leftY = leftPoint.y
    const rightY = rightPoint.y
    if (Math.abs(leftY - rightY) >= 0.15) {
      return [
        {
          type: "pcb_trace_error",
          message: "severe candidate DRC error",
        },
      ]
    }
    return [
      { type: "pcb_trace_error", message: "gap: 0.068mm" },
      { type: "pcb_trace_error", message: "gap: 0.066mm" },
    ]
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
  })

  solver.solve()

  expect(solver.getOutput()).toEqual(hdRoutes)
  expect(solver.stats.drcBranchPortfolioBaselineDrcIssueCount).toBe(2)
  expect(solver.stats.drcBranchPortfolioBroadInitialDrcIssueCount).toBe(1)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
})
