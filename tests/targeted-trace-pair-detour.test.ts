import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import {
  applyTracePairDetourForError,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("routes an exact trace crossing around the blocking segment endpoint", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.05,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: 0, y: -0.2, z: 0 },
        { x: 0, y: 0.2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyTracePairDetourForError({
    srj,
    routes,
    error: {
      type: "pcb_trace_error",
      pcb_trace_id: "source_net_1_mst0_0",
      pcb_trace_error_id: "overlap_source_net_1_mst0_0_source_net_2_mst0_0",
      center: { x: 0, y: 0 },
    },
    traceRouteIndexById: new Map([
      ["source_net_1_mst0_0", 0],
      ["source_net_2_mst0_0", 1],
    ]),
    routeSide: 0,
    blockingEndpointSide: 0,
  })

  expect(changed).toBe(true)
  expect(routes[0]?.route).toHaveLength(4)
  expect(Math.min(...routes[0]!.route.map((point) => point.y))).toBeCloseTo(
    -0.4,
  )
  expect(routes[1]?.route).toHaveLength(2)
})

test("targeted repair runs trace-pair detours without enabling via-in-pad moves", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes = [
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: 0, y: -0.2, z: 0 },
        { x: 0, y: 0.2, z: 0 },
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
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    drcEvaluator: ({ routes }) =>
      (routes?.[0]?.route.length ?? 0) < 4
        ? [
            {
              type: "pcb_trace_error",
              pcb_trace_id: "source_net_1_mst0_0",
              pcb_trace_error_id:
                "overlap_source_net_1_mst0_0_source_net_2_mst0_0",
              center: { x: 0, y: 0 },
            },
          ]
        : [],
  })

  solver.solve()

  expect(solver.getOutput()[0]?.route).toHaveLength(4)
  expect(
    solver.stats.globalDrcForceImproveTracePairDetourAttempts,
  ).toBeGreaterThan(0)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidateAttempts).toBe(0)
})
