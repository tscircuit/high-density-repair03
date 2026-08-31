import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("keeps the baseline when the broad candidate does not lower DRC errors", () => {
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
    obstacles: [
      {
        type: "rect",
        center: { x: 5, y: 5 },
        width: 1,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign_pad"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const leftY = routes?.[0]?.route[1]?.y ?? 0
    const rightY = routes?.[1]?.route[1]?.y ?? 0
    const separation = Math.abs(leftY - rightY)
    const midpoint = (leftY + rightY) / 2
    const errors: Record<string, unknown>[] = [
      {
        type: "pcb_trace_error",
        message: "persistent externally constrained violation",
        pcb_trace_id: "trace_120",
      },
    ]
    if (separation < 0.15) {
      errors.push({
        type: "pcb_trace_error",
        message: "A is too close to B",
        pcb_trace_id: "trace_0",
      })
    }
    if (Math.abs(midpoint - 5.01) < 0.01) {
      errors.push({
        type: "pcb_trace_error",
        message: 'PCB trace trace[A] overlaps with pcb_smtpad "foreign_pad"',
        pcb_trace_id: "trace_0",
        ...(separation < 0.15 ? { center: { x: 5, y: 5 } } : {}),
      })
    }
    return errors
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
  })

  solver.solve()

  expect(drcEvaluator({ traces: [], routes: solver.getOutput() })).toHaveLength(
    1,
  )
  expect(solver.stats.drcBranchPortfolioBaselineDrcIssueCount).toBe(1)
  expect(solver.stats.drcBranchPortfolioBroadInitialDrcIssueCount).toBe(1)
  expect(solver.stats.drcBranchPortfolioBroadFinalDrcIssueCount).toBeUndefined()
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
})
