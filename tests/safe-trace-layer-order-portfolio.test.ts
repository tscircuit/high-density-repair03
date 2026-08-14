import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

const srj: SimpleRouteJson = {
  bounds: { minX: -1, minY: -2, maxX: 10, maxY: 2 },
  connections: [
    {
      name: "route",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 9, y: 0, layer: "top" },
      ],
    },
  ],
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: Array.from({ length: 10 }, (_, x) => ({ x, y: 0, z: 0 })),
    vias: [],
  },
]

const evaluateDrc: DrcEvaluator = ({ routes }) => {
  const route = routes?.[0]?.route ?? []
  const firstTransitionIndex = route.findIndex(
    (point, index) =>
      index < route.length - 1 && route[index + 1]?.z !== point.z,
  )
  const errorCount =
    firstTransitionIndex === -1 ? 2 : firstTransitionIndex <= 1 ? 1 : 0
  const errors = Array.from({ length: errorCount }, (_, index) => ({
    type: "pcb_trace_error",
    pcb_trace_id: "route_0",
    pcb_trace_error_id: `overlap_route_0_obstacle_${index}`,
    message: `PCB trace route_0 overlaps pcb_smtpad obstacle_${index}`,
    center: { x: 4 + index, y: 0 },
  }))
  return { errors, errorsWithCenters: errors }
}

test("selects the exact-safe local branch when a full-span move gets trapped", () => {
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: inputRoutes,
    drcEvaluator: evaluateDrc,
    maxIterations: 8,
    broadMaxIterations: 2,
    broadPassMultiplier: 1,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputSnapshot = getDrcSnapshot(srj, solver.getOutput(), evaluateDrc)
  expect(outputSnapshot.count).toBe(0)
  expect(
    solver.stats.drcBranchPortfolioSafeTraceLayerLocalFinalDrcIssueCount,
  ).toBe(0)
  expect(
    solver.stats.drcBranchPortfolioSafeTraceLayerFullFinalDrcIssueCount,
  ).toBe(1)
  expect(solver.stats.drcBranchPortfolioSafeTraceLayerSelectedOrder).toBe(
    "local_first",
  )
})
