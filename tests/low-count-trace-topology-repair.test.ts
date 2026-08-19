import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("tries trace topology repair when the initial DRC count is three", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: ["net_a", "net_b"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_b",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const persistentErrors = [0, 1].map((index) => ({
    type: "pcb_trace_error",
    message: `externally constrained error ${index}`,
  }))
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const usedSameLayerTopology = routes?.some(
      (route) =>
        route.route.length > 2 && route.route.every((point) => point.z === 0),
    )
    if (usedSameLayerTopology) {
      return { errors: persistentErrors, errorsWithCenters: [] }
    }
    const crossingError = {
      type: "pcb_trace_error",
      pcb_trace_id: "net_a_0",
      pcb_trace_error_id: "overlap_net_a_0_net_b_0",
      message: "net_a crosses net_b",
      center: { x: 0, y: 0 },
    }
    return {
      errors: [crossingError, ...persistentErrors],
      errorsWithCenters: [crossingError],
    }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
  })

  solver.solve()

  expect(solver.stats.finalDrcIssueCount).toBe(persistentErrors.length)
  expect(
    solver
      .getOutput()
      .some(
        (route) =>
          route.route.length > 2 && route.route.every((point) => point.z === 0),
      ),
  ).toBe(true)
})
