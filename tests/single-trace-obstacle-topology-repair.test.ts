import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("repairs a low-count trace-to-obstacle conflict with a topology detour", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: [{ name: "net_a", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "port_a" },
        { x: 2, y: 0, z: 0, pcb_port_id: "port_b" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    if ((routes?.[0]?.route.length ?? 0) > 2) return { errors: [] }
    const error = {
      type: "pcb_trace_error",
      pcb_trace_id: "net_a_0",
      pcb_trace_error_id: "overlap_net_a_0_pcb_plated_hole_1",
      message: "net_a is too close to pcb_plated_hole_1",
      center: { x: 0, y: 0 },
      worst_contact_center: { x: 0.5, y: 0 },
    }
    return { errors: [error], errorsWithCenters: [error] }
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

  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[0]!.route.length).toBeGreaterThan(2)
})
