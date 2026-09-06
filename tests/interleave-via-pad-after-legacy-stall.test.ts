import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("repairs independent via-pad errors while a legacy error remains", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "via_net", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "via_net",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Array<Record<string, unknown>> = [
      {
        type: "pcb_trace_error",
        pcb_trace_id: "fixed_trace",
        center: { x: 1.5, y: 1.5 },
      },
    ]
    const viaX = routes?.[0]?.route[1]?.x ?? 0
    if (Math.abs(viaX) <= 1e-6) {
      errors.push({
        type: "pcb_pad_pad_clearance_error",
        pcb_trace_id: "via_net_0",
        pcb_via_ids: ["via_0"],
        center: { x: 0.2, y: 0 },
      })
    }
    return errors
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 6,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const result = drcEvaluator({ traces: [], routes: solver.getOutput() })
  const errors = Array.isArray(result) ? result : result.errors
  expect(errors).toHaveLength(1)
  expect(errors[0]?.pcb_trace_id).toBe("fixed_trace")
})
