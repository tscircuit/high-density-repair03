import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

const getViaPosition = (route: HighDensityRoute) => ({
  x: route.route[1]!.x,
  y: route.route[1]!.y,
})

test("uses evaluator via identity and an orientation portfolio for same-net clearance", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_1_mst1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: -0.003, z: 0 },
        { x: 0, y: -0.003, z: 0 },
        { x: 0, y: -0.003, z: 1 },
        { x: 1, y: -0.003, z: 1 },
      ],
      vias: [{ x: 0, y: -0.003 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_1_mst1",
      route: [
        { x: -1, y: 0.003, z: 0 },
        { x: 0, y: 0.003, z: 0 },
        { x: 0, y: 0.003, z: 1 },
        { x: 1, y: 0.003, z: 1 },
      ],
      vias: [{ x: 0, y: 0.003 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const evaluator: DrcEvaluator = ({ routes = [] }) => {
    const left = getViaPosition(routes[0]!)
    const right = getViaPosition(routes[1]!)
    const distance = Math.hypot(left.x - right.x, left.y - right.y)
    const pcbViaTraceIdById = {
      via_left: "source_net_1_mst0_0",
      via_right: "source_net_1_mst1_0",
    }
    const pcbViaPositionById = { via_left: left, via_right: right }

    // The original separation direction is blocked; perpendicular candidates
    // remain legal. This verifies that candidate orientation is scored rather
    // than hard-coded to the initial center-to-center vector.
    if (Math.abs(left.y) > 0.05 || Math.abs(right.y) > 0.05) {
      const blockedErrors = [0, 1].map((index) => ({
        type: "pcb_trace_error",
        message: `blocked candidate ${index}`,
        center: { x: 0, y: 0 },
      }))
      return {
        errors: blockedErrors,
        errorsWithCenters: blockedErrors,
        pcbViaTraceIdById,
        pcbViaPositionById,
      }
    }

    if (distance >= 0.4) return []
    const error = {
      type: "pcb_via_clearance_error",
      message: `Via gap: ${distance - 0.3}mm, required: 0.1mm`,
      pcb_via_ids: ["via_left", "via_right"],
      center: {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
      },
    }
    return {
      errors: [error],
      errorsWithCenters: [error],
      pcbViaTraceIdById,
      pcbViaPositionById,
    }
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["source_net_1_mst0", "source_net_1"],
    ["source_net_1_mst1", "source_net_1"],
  ])
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    drcEvaluator: evaluator,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  const [leftRoute, rightRoute] = solver.getOutput()
  const left = getViaPosition(leftRoute!)
  const right = getViaPosition(rightRoute!)
  expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(
    0.4,
  )
  expect(Math.abs(left.y)).toBeLessThan(0.05)
  expect(Math.abs(right.y)).toBeLessThan(0.05)
  expect(evaluator({ traces: [], routes: solver.getOutput() })).toEqual([])
})
