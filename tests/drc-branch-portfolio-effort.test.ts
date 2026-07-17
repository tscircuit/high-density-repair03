import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("higher effort explores a stronger branch after the 1x search plateaus", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const middleY =
      ((routes?.[0]?.route[1]?.y ?? 0) + (routes?.[0]?.route[2]?.y ?? 0)) / 2
    if (middleY >= 0.15) return []
    return [
      {
        type: "pcb_trace_error",
        message: "synthetic clearance trap",
        center: { x: 5, y: 0 },
        pcb_trace_id: "A_0",
      },
    ]
  }
  const createSolver = (effort: number) =>
    new GlobalDrcBranchPortfolioSolver({
      srj,
      hdRoutes,
      effort,
      drcEvaluator,
      maxIterations: 4,
      broadMaxIterations: 4,
      broadPassMultiplier: 3,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: true,
      enablePostSolveClearanceRelaxation: false,
    })

  const oneX = createSolver(1)
  oneX.solve()
  const fiveX = createSolver(5)
  fiveX.solve()

  expect(drcEvaluator({ traces: [], routes: oneX.getOutput() })).toHaveLength(1)
  expect(drcEvaluator({ traces: [], routes: fiveX.getOutput() })).toEqual([])
  expect(fiveX.stats.drcBranchPortfolioBranchesAttempted).toBeGreaterThan(
    oneX.stats.drcBranchPortfolioBranchesAttempted,
  )
  expect(fiveX.stats.drcBranchPortfolioSelectedBranch).toBe("targeted-strong")
})
