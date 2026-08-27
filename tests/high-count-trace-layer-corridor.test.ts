import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("reroutes a shared trace-pair route when it removes two of eight DRC errors", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: ["net_a", "net_b", "net_c"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minBoardEdgeClearance: 0.2,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      route: [
        { x: 0, y: -1, z: 1 },
        { x: 0, y: 1, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_b",
      route: [
        { x: 1, y: 0, z: 1 },
        { x: -1, y: 0, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_c",
      route: [
        { x: -1, y: -1, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const persistentErrors = Array.from({ length: 6 }, (_, index) => ({
    type: "pcb_trace_error",
    message: `externally constrained error ${index}`,
  }))
  const sharedRouteErrors = ["net_a", "net_c"].map((connectionName) => ({
    type: "pcb_trace_error",
    pcb_trace_id: `${connectionName}_0`,
    pcb_trace_error_id: `overlap_${connectionName}_0_net_b_0`,
    message: `${connectionName} crosses net_b`,
    center: { x: 0, y: 0 },
  }))
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const sharedRoute = routes?.find(
      (route) => route.connectionName === "net_b",
    )
    const usedLayerCorridor =
      sharedRoute?.route.length === 8 &&
      sharedRoute.route.some((point) => point.z === 0) &&
      sharedRoute.vias.length === 2
    return usedLayerCorridor
      ? { errors: persistentErrors, errorsWithCenters: [] }
      : {
          errors: [...sharedRouteErrors, ...persistentErrors],
          errorsWithCenters: sharedRouteErrors,
        }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
  })

  solver.solve()

  expect(solver.stats.initialDrcIssueCount).toBe(8)
  expect(solver.stats.finalDrcIssueCount).toBe(6)
  expect(solver.getOutput()[1]?.vias).toHaveLength(2)
})
