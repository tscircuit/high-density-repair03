import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../../lib"

const overlap = {
  type: "pcb_trace_error",
  pcb_trace_error_id: "overlap_net_a_0_foreign_pad",
  pcb_trace_id: "net_a_0",
  message:
    'PCB trace net_a_0 overlaps with pcb_smtpad "foreign_pad" (accidental contact)',
  actual_clearance: -0.04,
}

const persistentErrors = Array.from({ length: 3 }, (_, index) => ({
  type: "pcb_trace_error",
  message: `externally constrained clearance ${index}`,
}))

const createSrj = (routes: HighDensityRoute[]): SimpleRouteJson => ({
  bounds: { minX: -2, minY: -2, maxX: 10, maxY: 10 },
  connections: routes.map((route) => ({
    name: route.connectionName,
    pointsToConnect: [],
  })),
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
})

export const createBroadOverlapCase = ({
  rawOnly,
  existingOverlap,
  overlapError = overlap,
}: {
  rawOnly: boolean
  existingOverlap: boolean
  overlapError?: Record<string, unknown>
}) => {
  const hdRoutes: HighDensityRoute[] = ["net_a", "net_b"].map(
    (connectionName, index) => ({
      connectionName,
      route: [1, 3, 7, 9].map((x) => ({
        x,
        y: 5 + index * 0.02,
        z: 0,
      })),
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const originalRoutes = structuredClone(hdRoutes)
  let overlapCandidates = 0
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const original = routes?.every((route, routeIndex) =>
      route.route.every(
        (point, pointIndex) =>
          point.y === originalRoutes[routeIndex]!.route[pointIndex]!.y,
      ),
    )
    // The evaluator holds the baseline fixed and reports a lower-count
    // contact after broad repulsion moves the internal route points.
    if (!original) overlapCandidates++
    const errors = original
      ? [...persistentErrors, ...(existingOverlap ? [overlapError] : [])]
      : [overlapError]
    return {
      errors,
      errorsWithCenters: rawOnly ? [] : errors,
    }
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj: createSrj(hdRoutes),
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    broadMaxIterations: 1,
    broadPassMultiplier: 3,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  })
  return {
    solver,
    hdRoutes,
    originalRoutes,
    getOverlapCandidates: () => overlapCandidates,
  }
}

export const createRawOverlapCase = (referenceDrcEvaluator?: DrcEvaluator) => {
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
  const originalRoutes = structuredClone(hdRoutes)
  let overlapCandidates = 0
  const crossingError = {
    type: "pcb_trace_error",
    pcb_trace_id: "net_a_0",
    pcb_trace_error_id: "overlap_net_a_0_net_b_0",
    message: "net_a crosses net_b",
    center: { x: 0, y: 0 },
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    if (
      routes?.some(
        (route) =>
          route.route.length > 2 && route.route.every((point) => point.z === 0),
      )
    ) {
      overlapCandidates++
      return { errors: [overlap], errorsWithCenters: [] }
    }
    return {
      errors: [crossingError, ...persistentErrors.slice(0, 2)],
      errorsWithCenters: [crossingError],
    }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj: createSrj(hdRoutes),
    hdRoutes,
    drcEvaluator,
    referenceDrcEvaluator,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
  })

  return {
    solver,
    hdRoutes,
    originalRoutes,
    drcEvaluator,
    getOverlapCandidates: () => overlapCandidates,
  }
}
