import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("widens a default-mode pad detour resolved through PCB-port aliases", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [{ name: "routed_net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.2,
        connectedTo: ["foreign_net", "pcb_port_foreign"],
        obstacleId: "source_pad_foreign",
      },
    ],
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "routed_net",
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "start" },
        { x: 2, y: 0, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const padError = {
    type: "pcb_trace_error",
    pcb_trace_id: "routed_net_0",
    pcb_trace_error_id: "overlap_routed_net_0_pcb_smtpad_foreign",
    pcb_pad_id: "pcb_smtpad_foreign",
    pcb_port_ids: ["pcb_port_foreign"],
    center: { x: 0, y: 0 },
    minimum_clearance: 0.1,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const route = routes?.[0]?.route ?? []
    if (route.length <= 2) {
      return { errors: [padError], errorsWithCenters: [padError] }
    }

    const maximumDetourY = Math.max(...route.map((point) => Math.abs(point.y)))
    if (maximumDetourY >= 0.8) return { errors: [] }

    const blockingErrors = ["upper", "lower"].map((side) => ({
      type: "pcb_trace_error",
      pcb_trace_id: "routed_net_0",
      pcb_trace_error_id: `overlap_routed_net_0_blocker_${side}`,
      center: { x: 0, y: side === "upper" ? 0.3 : -0.3 },
    }))
    return { errors: blockingErrors, errorsWithCenters: blockingErrors }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
    repairMode: "default",
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(
    solver.stats.globalDrcForceImprovePadTraceClearanceDetourAttempts,
  ).toBeGreaterThan(2)
  expect(
    Math.max(...solver.getOutput()[0]!.route.map((point) => Math.abs(point.y))),
  ).toBeGreaterThanOrEqual(0.8)
})

test("repairs a grazing pad clearance with a single tangent corner", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "routed_net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["foreign_net", "pcb_port_foreign"],
        obstacleId: "source_pad_foreign",
      },
    ],
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "routed_net",
      route: [
        { x: -1, y: -0.3, z: 0, pcb_port_id: "start" },
        { x: 1, y: 0.3, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const padError = {
    type: "pcb_trace_error",
    pcb_trace_id: "routed_net_0",
    pcb_trace_error_id: "overlap_routed_net_0_pcb_smtpad_foreign",
    pcb_pad_id: "pcb_smtpad_foreign",
    pcb_port_ids: ["pcb_port_foreign"],
    center: { x: 0, y: 0 },
    minimum_clearance: 0.1,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const route = routes?.[0]?.route ?? []
    return route.length === 3
      ? { errors: [] }
      : { errors: [padError], errorsWithCenters: [padError] }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[0]!.route).toHaveLength(3)
})

test("relocates a blocked layer transition without adding a corner detour", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "routed_net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign", "foreign_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "routed_net",
      route: [
        { x: -1, y: -1, z: 1, pcb_port_id: "start" },
        { x: -0.085, y: -0.2, z: 1 },
        { x: -0.085, y: -0.2, z: 0 },
        { x: 0, y: -0.45, z: 0, pcb_port_id: "end" },
      ],
      vias: [{ x: -0.085, y: -0.2 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const padError = {
    type: "pcb_trace_error",
    pcb_trace_id: "routed_net_0",
    pcb_trace_error_id: "overlap_routed_net_0_pcb_smtpad_foreign",
    pcb_pad_id: "pcb_smtpad_foreign",
    center: { x: -0.085, y: -0.15 },
    minimum_clearance: 0.1,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const route = routes?.[0]?.route ?? []
    const transition = route.find(
      (point, index) =>
        route[index + 1]?.z !== undefined && route[index + 1]?.z !== point.z,
    )
    if (route.length === 4 && (transition?.y ?? 0) <= -0.25) {
      return { errors: [] }
    }
    if (route.length > 4) {
      const cornerErrors = ["left", "right"].map((side) => ({
        type: "pcb_trace_error",
        pcb_trace_id: "routed_net_0",
        pcb_trace_error_id: `overlap_routed_net_0_corner_${side}`,
        center: { x: side === "left" ? -0.4 : 0.4, y: -0.25 },
      }))
      return { errors: cornerErrors, errorsWithCenters: cornerErrors }
    }
    return { errors: [padError], errorsWithCenters: [padError] }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
    repairMode: "safe_topology_only",
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[0]!.route).toHaveLength(4)
  expect(solver.getOutput()[0]!.route[1]?.y).toBeCloseTo(-0.250001)
  expect(solver.getOutput()[0]!.route[2]?.y).toBeCloseTo(-0.250001)
})
