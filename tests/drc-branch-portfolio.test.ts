import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("uses a broad branch only when it lowers the exact DRC count", () => {
  const collidingRoutes: HighDensityRoute[] = ["A", "B"].map(
    (connectionName, index) => ({
      connectionName,
      route: [
        { x: 1, y: 5 + index * 0.02, z: 0 },
        { x: 3, y: 5 + index * 0.02, z: 0 },
        { x: 7, y: 5 + index * 0.02, z: 0 },
        { x: 9, y: 5 + index * 0.02, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const distantRoutes: HighDensityRoute[] = Array.from(
    { length: 119 },
    (_, index) => ({
      connectionName: `dummy_${index}`,
      route: [
        { x: 1, y: 20 + index * 2, z: 0 },
        { x: 9, y: 20 + index * 2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const hdRoutes = [...collidingRoutes, ...distantRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 260 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const leftY = routes?.[0]?.route[1]?.y ?? 0
    const rightY = routes?.[1]?.route[1]?.y ?? 0
    if (Math.abs(leftY - rightY) >= 0.15) return []
    return [
      {
        type: "pcb_trace_error",
        message: "A is too close to B",
        pcb_trace_id: "A_0",
      },
    ]
  }
  const inputJson = JSON.stringify(hdRoutes)
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadPassMultiplier: 3,
  })

  solver.solve()

  const output = solver.getOutput()
  expect(drcEvaluator({ traces: [], routes: output })).toEqual([])
  expect(JSON.stringify(hdRoutes)).toBe(inputJson)
  expect(solver.stats.drcBranchPortfolioBaselineDrcIssueCount).toBe(1)
  expect(solver.stats.drcBranchPortfolioBroadInitialDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(true)
})
