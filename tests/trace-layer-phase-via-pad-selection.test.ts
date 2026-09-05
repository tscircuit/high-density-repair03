import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("keeps trace-layer improvements for via-pad repair without accepting via-trace regressions", () => {
  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [
          { x: 0, y: -2, layer: "top" },
          { x: 0, y: 2, layer: "top" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = srj.connections.map((connection) => ({
    connectionName: connection.name,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: connection.pointsToConnect.map((point) => ({
      x: point.x,
      y: point.y,
      z: 0,
    })),
  }))
  const initialError = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    pcb_trace_error_id: "overlap_trace_0_foreign_0",
    center: { x: 0, y: 0 },
  }
  for (const errorType of [
    "pcb_pad_pad_clearance_error",
    "pcb_via_trace_clearance_error",
  ]) {
    const residualError = {
      type: errorType,
      pcb_via_ids: ["trace_via_0"],
      center: { x: -2, y: 0 },
    }
    const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
      const candidateRoutes = hdRoutes ?? routes
      if (!candidateRoutes) throw new Error("Expected candidate routes")
      return candidateRoutes.some((route) =>
        route.route.some((point) => point.z !== 0),
      )
        ? [residualError]
        : [initialError]
    }
    const solver = new GlobalDrcBranchPortfolioSolver({
      srj,
      hdRoutes,
      drcEvaluator,
      maxIterations: 2,
      broadMaxIterations: 1,
      broadPassMultiplier: 1,
      viaInPadMaxIterations: 1,
      enableLargeBoardBroadFallback: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    })
    solver.solve()

    expect(solver.solved).toBe(true)
    const shouldAccept = errorType === "pcb_pad_pad_clearance_error"
    expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted).toBe(
      shouldAccept,
    )
    expect(drcEvaluator({ traces: [], hdRoutes: solver.getOutput() })).toEqual([
      shouldAccept ? residualError : initialError,
    ])
  }
  expect(
    hdRoutes.every((route) => route.route.every((point) => point.z === 0)),
  ).toBe(true)
})
