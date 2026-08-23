import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type SimpleRouteJson,
} from "../lib"

test("force improvement and its branch portfolio are best effort", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const residualError = {
    type: "pcb_trace_error",
    message: "synthetic residual DRC",
    center: { x: 5, y: 5 },
  }
  const drcEvaluator: DrcEvaluator = () => [residualError]
  const forceImproveParams = {
    srj,
    hdRoutes: [],
    drcEvaluator,
    maxIterations: 1,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  }
  const portfolioParams = {
    ...forceImproveParams,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  }

  expect(
    () =>
      new GlobalDrcBranchPortfolioSolver({
        ...portfolioParams,
        broadPassMultiplier: Number.NaN,
      }),
  ).toThrow("broadPassMultiplier must be a finite number")

  const bestEffortSolver = new GlobalDrcForceImproveSolver(forceImproveParams)
  bestEffortSolver.solve()

  expect(bestEffortSolver.solved).toBe(true)
  expect(bestEffortSolver.failed).toBe(false)
  expect(bestEffortSolver.stats.finalDrcIssueCount).toBe(1)

  const bestEffortPortfolioSolver = new GlobalDrcBranchPortfolioSolver(
    portfolioParams,
  )
  bestEffortPortfolioSolver.solve()

  expect(bestEffortPortfolioSolver.solved).toBe(true)
  expect(bestEffortPortfolioSolver.failed).toBe(false)
  expect(bestEffortPortfolioSolver.stats.finalDrcIssueCount).toBe(1)
  expect(
    bestEffortPortfolioSolver.stats.drcBranchPortfolioBroadInitialDrcIssueCount,
  ).toBe(1)
  expect(
    bestEffortPortfolioSolver.stats.drcBranchPortfolioBroadFinalDrcIssueCount,
  ).toBeUndefined()
  expect(
    bestEffortPortfolioSolver.stats.drcBranchPortfolioBroadMaxIterations,
  ).toBe(1)
  expect(
    bestEffortPortfolioSolver.stats.drcBranchPortfolioBroadBranchAttempted,
  ).toBe(false)
  expect(
    bestEffortPortfolioSolver.stats.drcBranchPortfolioBroadBranchAccepted,
  ).toBe(false)
  expect(
    bestEffortPortfolioSolver.stats.globalDrcForceImproveBroadForceAccepted,
  ).toBe(false)
})
