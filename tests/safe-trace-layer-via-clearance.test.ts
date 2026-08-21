import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

const srj: SimpleRouteJson = {
  bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.1,
  obstacles: [
    {
      type: "rect",
      center: { x: -2, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal", "signal_start"],
    },
    {
      type: "rect",
      center: { x: 2, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal", "signal_end"],
    },
  ],
  connections: [
    { name: "signal_mst0", pointsToConnect: [] },
    { name: "blocker", pointsToConnect: [] },
    { name: "signal_mst1", pointsToConnect: [] },
  ],
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "signal_mst0",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "signal_start" },
      { x: 2, y: 0, z: 0, pcb_port_id: "signal_end" },
    ],
    vias: [],
  },
  {
    connectionName: "blocker",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    vias: [],
  },
  {
    connectionName: "signal_mst1",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1.6, y: 0, z: 0 },
      { x: -1.6, y: 0, z: 1 },
      { x: -1.6, y: 1, z: 1 },
    ],
    vias: [{ x: -1.6, y: 0 }],
  },
]

const traceError = {
  type: "pcb_trace_error",
  pcb_trace_id: "signal_mst0_0",
  pcb_trace_error_id: "overlap_signal_mst0_0_blocker_0",
  center: { x: 0, y: 0 },
}

const existingViaError = {
  type: "pcb_via_trace_clearance_error",
  pcb_via_ids: ["existing_via"],
  center: { x: -1.6, y: 0 },
}

const getTransitionPoint = (route: HighDensityRoute) =>
  route.route.find(
    (point, pointIndex) => route.route[pointIndex + 1]?.z !== point.z,
  )

const drcEvaluator: DrcEvaluator = ({
  hdRoutes: candidateHdRoutes,
  routes,
}) => {
  const candidateRoutes = candidateHdRoutes ?? routes ?? []
  const movedSignalRoute = candidateRoutes.find(
    (route) => route.connectionName === "signal_mst0",
  )
  const stitchingRoute = candidateRoutes.find(
    (route) => route.connectionName === "signal_mst1",
  )
  const movedSignalVia = movedSignalRoute
    ? getTransitionPoint(movedSignalRoute)
    : undefined
  const stitchingVia = stitchingRoute
    ? getTransitionPoint(stitchingRoute)
    : undefined
  const signalUsesBottomLayer = movedSignalRoute?.route.some(
    (point) => point.z === 1,
  )

  if (!signalUsesBottomLayer) {
    return {
      errors: [traceError, existingViaError],
      errorsWithCenters: [traceError, existingViaError],
    }
  }
  if (!movedSignalVia || !stitchingVia) return []

  const viasAreCanonical =
    movedSignalVia.x === stitchingVia.x && movedSignalVia.y === stitchingVia.y
  if (viasAreCanonical) return []

  const sameNetViaError = {
    type: "pcb_via_clearance_error",
    pcb_error_id: "same_net_vias_close_via_0_via_1",
    pcb_via_ids: ["via_0", "via_1"],
    pcb_via_pair_net_relation: "same_net",
    center: {
      x: (movedSignalVia.x + stitchingVia.x) / 2,
      y: (movedSignalVia.y + stitchingVia.y) / 2,
    },
  }
  return {
    errors: [sameNetViaError],
    errorsWithCenters: [sameNetViaError],
  }
}

test("shows a safe trace-layer repair leaving a same-net via violation", () => {
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 8,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputSnapshot = getDrcSnapshot(srj, solver.getOutput(), drcEvaluator)
  expect(solver.failed).toBe(false)
  expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted).toBe(true)
  expect(
    outputSnapshot.errors.map((error) => error.type),
  ).toMatchInlineSnapshot(`
    [
      "pcb_via_clearance_error",
    ]
  `)
})
