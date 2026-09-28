import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("exhausted layer moves still terminate at a DRC plateau", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
  ]
  const errors = [
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: "trace_0",
      pcb_smtpad_id: "pcb_smtpad_foreign",
      center: { x: 0, y: 0 },
    },
    ...Array.from({ length: 3 }, (_, i) => ({
      type: "pcb_via_clearance_error",
      pcb_via_ids: [`unrelated_${i}`],
      center: { x: 4, y: 4 },
    })),
  ]
  const candidateLayers = new Set<number>()
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: structuredClone(hdRoutes),
    maxIterations: 128,
    enableBroadFallback: false,
    enableTargetedErrorSweep: false,
    enableSafeTraceLayerMoves: true,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: ({ hdRoutes, routes }) => {
      for (const route of hdRoutes ?? routes ?? []) {
        for (const point of route.route) candidateLayers.add(point.z)
      }
      return { errors, errorsWithCenters: errors }
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(candidateLayers).toEqual(new Set([0, 1, 2, 3]))
  expect(solver.iterations).toBeLessThan(128)
  expect(solver.stats.finalDrcIssueCount).toBe(4)
  expect(solver.getOutput()).toEqual(hdRoutes)
})
