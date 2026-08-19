import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("bounds detour search when an exact trace pair cannot be resolved", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [{ name: "route_0", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "route_0",
      route: [
        { x: 1, y: 5, z: 0 },
        { x: 9, y: 5, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: true,
    drcEvaluator: () => [
      {
        type: "pcb_trace_error",
        pcb_trace_id: "missing_trace_0",
        pcb_trace_error_id: "overlap_missing_trace_0_another_missing_trace_0",
        center: { x: 5, y: 5 },
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.residualDrcIssueCount).toBe(1)
  expect(solver.iterations).toBe(2)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidateAttempts).toBe(0)
})
