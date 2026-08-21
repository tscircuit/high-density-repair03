import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimplifiedPcbTraces,
  type SimpleRouteJson,
} from "../lib"
import {
  applyDrcErrorForces,
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("repairs the obstacle-layer segment when a wrong-layer segment is nearer", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      { name: "net_trace", pointsToConnect: [] },
      { name: "net_pad", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["net_pad", "pcb_smtpad_foreign", "pcb_port_foreign"],
      },
    ],
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_trace",
      rootConnectionName: "net_trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 1 },
        { x: 0.8, y: 0, z: 1 },
        { x: 0.8, y: 0, z: 2 },
        { x: 0.625, y: 0, z: 2 },
        { x: 1.5, y: 0, z: 2 },
        { x: 1.5, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      vias: [
        { x: 0.8, y: 0 },
        { x: 1.5, y: 0 },
      ],
    },
  ]
  const toSimplifiedTraces = (
    routes: HighDensityRoute[],
  ): SimplifiedPcbTraces =>
    routes.map((route) => {
      const simplifiedRoute: SimplifiedPcbTraces[number]["route"] = []
      for (let index = 0; index < route.route.length; index += 1) {
        const point = route.route[index]!
        const previous = route.route[index - 1]
        const getLayerName = (z: number) =>
          z === 0 ? "top" : z === srj.layerCount - 1 ? "bottom" : `inner${z}`
        const layer = getLayerName(point.z)
        if (previous && previous.z !== point.z) {
          simplifiedRoute.push({
            route_type: "via",
            x: point.x,
            y: point.y,
            from_layer: getLayerName(previous.z),
            to_layer: layer,
            via_diameter: route.viaDiameter,
          })
        }
        simplifiedRoute.push({
          route_type: "wire",
          x: point.x,
          y: point.y,
          width: route.traceThickness,
          layer,
        })
      }
      return {
        type: "pcb_trace",
        pcb_trace_id: `${route.connectionName}_0`,
        connection_name: route.rootConnectionName ?? route.connectionName,
        route: simplifiedRoute,
      }
    })
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes: candidateRoutes }) =>
    engine.evaluate(toSimplifiedTraces(routes ?? candidateRoutes ?? []))
  const initialSnapshot = getDrcSnapshot(srj, hdRoutes, drcEvaluator)

  expect(initialSnapshot.count).toBe(1)
  const error = initialSnapshot.errors[0]!
  expect(error.actual_clearance).toBe(0.075)
  expect(error.center).toEqual({ x: 0.5625, y: 0 })
  // The error center lies directly on the inner-layer segment, while the actual
  // bottom-layer conflict starts 0.0625 mm away at the transition.
  expect((error.center as { x: number }).x).toBeLessThan(
    hdRoutes[0]!.route[2]!.x,
  )
  const directPadTraceError = {
    ...error,
    type: "pcb_pad_trace_clearance_error",
    error_type: "pcb_pad_trace_clearance_error",
    message:
      "Pad pcb_port[#pcb_port_foreign] and trace trace[net_trace] are too close",
  }

  const safeLayerCandidate = cloneRoutes(hdRoutes)
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      safeLayerCandidate,
      directPadTraceError,
      0,
      0,
      1,
    ),
  ).toBe(true)
  expect(
    engine.evaluate(toSimplifiedTraces(materializeRoutes(safeLayerCandidate)))
      .errors,
  ).toHaveLength(0)

  const targetedCandidate = cloneRoutes(hdRoutes)
  expect(
    applyDrcErrorForces(
      srj,
      targetedCandidate,
      [directPadTraceError],
      initialSnapshot.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(
    engine.evaluate(toSimplifiedTraces(materializeRoutes(targetedCandidate)))
      .errors,
  ).toHaveLength(0)

  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 4,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    viaInPadMaxIterations: 4,
    broadMaxIterations: 4,
    broadPassMultiplier: 1,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    engine.evaluate(toSimplifiedTraces(solver.getOutput())).errors,
  ).toHaveLength(0)
  expect(solver.stats.drcBranchPortfolioInitialDrcIssueCount).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.globalDrcForceImproveTargetedForceAccepted).toBe(true)
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
})
