import { expect, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcBranchPortfolioSolver"
import { GlobalDrcForceImproveSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcEvaluator } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

test("moves terminal-reaching trace transitions outside connected pads", () => {
  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "end"],
      },
    ],
    connections: [
      {
        name: "foreign",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pointId: "foreign-start" },
          { x: 0, y: 1, layer: "top", pointId: "foreign-end" },
        ],
      },
      {
        name: "trace",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "start" },
          { x: 2, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "start" },
        { x: 2, y: 0, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
    },
    {
      connectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const traceError = {
    type: "pcb_trace_error",
    pcb_trace_id: "foreign_0",
    pcb_trace_error_id: "overlap_foreign_0_trace_0",
    center: { x: 0, y: 0 },
  }
  const initialErrors = [
    traceError,
    ...[-0.3, 0, 0.3].map((x, index) => ({
      type: "pcb_via_trace_clearance_error",
      pcb_via_ids: [`unrelated_via_${index}`],
      center: { x, y: 1 },
    })),
  ]
  const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const repairedTrace = candidateRoutes.find(
      (route) => route.connectionName === "trace",
    )
    const usesSecondInnerLayer = repairedTrace?.route.some(
      (point) => point.z === 2,
    )
    return usesSecondInnerLayer
      ? { errors: [], errorsWithCenters: [] }
      : { errors: initialErrors, errorsWithCenters: initialErrors }
  }
  const solverParams = {
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 8,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    viaInPadMaxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  }
  const solver = new GlobalDrcBranchPortfolioSolver(solverParams)

  expect(getDrcSnapshot(srj, hdRoutes, drcEvaluator).count).toBe(4)
  solver.solve()

  const outputRoute = solver
    .getOutput()
    .find((route) => route.connectionName === "trace")!
  const outputForeignRoute = solver
    .getOutput()
    .find((route) => route.connectionName === "foreign")!
  expect(solver.failed).toBe(false)
  expect(getDrcSnapshot(srj, [outputRoute], drcEvaluator).count).toBe(0)
  expect(outputRoute.vias).toHaveLength(2)
  expect(Math.abs(outputRoute.vias[0]!.x + 2) - 0.2).toBeGreaterThan(0.149)
  expect(Math.abs(outputRoute.vias[1]!.x - 2) - 0.2).toBeGreaterThan(0.149)
  expect(outputRoute.route[0]?.pcb_port_id).toBe("start")
  expect(outputRoute.route.at(-1)?.pcb_port_id).toBe("end")
  expect(outputForeignRoute.route).toEqual(hdRoutes[1]!.route)
  expect(
    outputRoute.route
      .slice(1, -1)
      .every((point) => point.pcb_port_id === undefined),
  ).toBe(true)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidatesAccepted).toBe(0)

  expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAttempted).toBe(true)
  expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted).toBe(true)

  const residualError = {
    type: "pcb_trace_error",
    pcb_trace_id: "residual_0",
    pcb_trace_error_id: "residual_trace_error",
    center: { x: 0, y: 1 },
  }
  const partialDrcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const candidateTrace = candidateRoutes.find(
      (route) => route.connectionName === "trace",
    )
    const movedToSecondInnerLayer = candidateTrace?.route.some(
      (point) => point.z === 2,
    )
    return movedToSecondInnerLayer
      ? { errors: [residualError], errorsWithCenters: [residualError] }
      : { errors: initialErrors, errorsWithCenters: initialErrors }
  }
  const partialSolver = new GlobalDrcBranchPortfolioSolver({
    ...solverParams,
    drcEvaluator: partialDrcEvaluator,
  })

  partialSolver.solve()

  expect(partialSolver.solved).toBe(true)
  expect(partialSolver.failed).toBe(false)
  expect(partialSolver.getOutput()).not.toEqual(hdRoutes)
  expect(
    getDrcSnapshot(srj, partialSolver.getOutput(), partialDrcEvaluator).count,
  ).toBe(1)
  expect(
    partialSolver.stats.drcBranchPortfolioSafeTraceLayerPhaseAttempted,
  ).toBe(true)
  expect(
    partialSolver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted,
  ).toBe(true)

  const unrelatedViaError = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_ids: ["unrelated_via"],
    center: { x: 0, y: 1 },
  }
  const traceCompleteDrcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const candidateTrace = candidateRoutes.find(
      (route) => route.connectionName === "trace",
    )
    const movedToSecondInnerLayer = candidateTrace?.route.some(
      (point) => point.z === 2,
    )
    return movedToSecondInnerLayer
      ? {
          errors: [unrelatedViaError],
          errorsWithCenters: [unrelatedViaError],
        }
      : { errors: initialErrors, errorsWithCenters: initialErrors }
  }
  const traceCompleteSolver = new GlobalDrcBranchPortfolioSolver({
    ...solverParams,
    drcEvaluator: traceCompleteDrcEvaluator,
  })

  traceCompleteSolver.solve()

  expect(traceCompleteSolver.solved).toBe(true)
  expect(traceCompleteSolver.failed).toBe(false)
  expect(traceCompleteSolver.getOutput()).not.toEqual(hdRoutes)
  expect(
    traceCompleteSolver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted,
  ).toBe(true)
})

test("reuses existing transitions around an internal trace conflict", () => {
  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "start" },
          { x: 2, y: 0, layer: "top", pointId: "end" },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pointId: "foreign-start" },
          { x: 0, y: 1, layer: "top", pointId: "foreign-end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "start" },
        { x: -1, y: 0, z: 0 },
        { x: -1, y: 0, z: 2 },
        { x: -0.5, y: 0, z: 2 },
        { x: -0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0, pcb_port_id: "end" },
      ],
      vias: [
        { x: -1, y: 0 },
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    {
      connectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 1 },
        { x: 0, y: 1, z: 1 },
      ],
      vias: [],
    },
  ]
  const traceError = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    pcb_trace_error_id: "overlap_trace_0_foreign_0",
    center: { x: 0, y: 0 },
  }
  const initialErrors = [
    traceError,
    ...[-0.3, 0, 0.3].map((x, index) => ({
      type: "pcb_via_trace_clearance_error",
      pcb_via_ids: [`unrelated_via_${index}`],
      center: { x, y: 1 },
    })),
  ]
  const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const repairedTrace = candidateRoutes.find(
      (route) => route.connectionName === "trace",
    )
    const movedConflictSpan = repairedTrace?.route
      .filter((point) => Math.abs(point.x) <= 0.5)
      .every((point) => point.z === 2)
    return movedConflictSpan
      ? { errors: [], errorsWithCenters: [] }
      : { errors: initialErrors, errorsWithCenters: initialErrors }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputTrace = solver
    .getOutput()
    .find((route) => route.connectionName === "trace")!
  const outputForeign = solver
    .getOutput()
    .find((route) => route.connectionName === "foreign")!
  expect(solver.failed).toBe(false)
  expect(getDrcSnapshot(srj, solver.getOutput(), drcEvaluator).count).toBe(0)
  expect(outputTrace.vias).toEqual([
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ])
  expect(outputTrace.route[0]?.pcb_port_id).toBe("start")
  expect(outputTrace.route.at(-1)?.pcb_port_id).toBe("end")
  expect(outputForeign.route).toEqual(hdRoutes[1]!.route)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidatesAccepted).toBe(0)
})
