import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("retracts a crowded SMT terminal without disconnecting its port", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      {
        name: "target",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "terminal_port",
            pcb_port_id: "terminal_port",
          },
          { x: -2, y: 0, layer: "top", pointId: "remote_port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 0.7,
        connectedTo: ["pcb_smtpad_1", "target", "terminal_port"],
        obstacleId: "pcb_smtpad_1",
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0.9, y: 0 },
        width: 1.5,
        height: 1.5,
        connectedTo: ["pcb_plated_hole_1", "foreign"],
        obstacleId: "pcb_plated_hole_1",
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const inputRoutes: HighDensityRoute[] = [
    {
      connectionName: "target",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "terminal_port" },
        { x: -2, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const evaluateDrc: DrcEvaluator = ({ routes, hdRoutes }) => {
    const endpoint = (routes ?? hdRoutes)?.[0]?.route[0]
    const clearance = endpoint
      ? Math.hypot(endpoint.x - 0.9, endpoint.y) - 0.75 - 0.075
      : -Infinity
    if (clearance >= 0.1) return { errors: [], errorsWithCenters: [] }
    const error = {
      type: "pcb_pad_trace_clearance_error",
      error_type: "pcb_pad_trace_clearance_error",
      pcb_pad_trace_clearance_error_id:
        "pad_trace_clearance_pcb_plated_hole_1_target_0",
      pcb_pad_id: "pcb_plated_hole_1",
      pcb_trace_id: "target_0",
      center: { x: 0.45, y: 0 },
      actual_clearance: clearance,
      minimum_clearance: 0.1,
      message:
        "Pad pcb_plated_hole_1 and trace target_0 are too close to the terminal",
    }
    return { errors: [error], errorsWithCenters: [error] }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    drcEvaluator: evaluateDrc,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  expect(getDrcSnapshot(srj, inputRoutes, evaluateDrc).count).toBe(1)
  solver.solve()

  const output = solver.getOutput()
  const endpoint = output[0]!.route[0]!
  expect(getDrcSnapshot(srj, output, evaluateDrc).count).toBe(0)
  expect(endpoint.pcb_port_id).toBe("terminal_port")
  expect(endpoint.x).toBeLessThan(0)
  expect(endpoint.x).toBeGreaterThanOrEqual(-0.5)
  expect(Math.abs(endpoint.y)).toBeLessThanOrEqual(0.35)
  expect(output[0]!.route[1]).toEqual(inputRoutes[0]!.route[1])
  expect(
    solver.stats.globalDrcForceImproveTerminalPadRetractionCandidateAttempts,
  ).toBe(3)
  expect(
    solver.stats.globalDrcForceImproveTerminalPadRetractionCandidatesAccepted,
  ).toBe(1)
})
