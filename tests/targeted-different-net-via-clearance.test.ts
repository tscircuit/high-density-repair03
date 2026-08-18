import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

const getViaPoint = (route: HighDensityRoute) =>
  route.route.find((point, index) => {
    const next = route.route[index + 1]
    return (
      next && point.z !== next.z && point.x === next.x && point.y === next.y
    )
  })

test("prioritizes different-net via clearance over a trace topology repair", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "net_a", pointsToConnect: [] },
      { name: "net_b", pointsToConnect: [] },
      { name: "net_c", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const inputRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
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
    {
      connectionName: "net_b",
      route: [
        { x: -1, y: 0.05, z: 0 },
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0.05, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_c",
      route: [
        { x: -1, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    maxIterations: 1,
    enableBroadFallback: false,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    drcEvaluator: ({ routes }) => {
      const routeA = routes![0]!
      const routeB = routes![1]!
      const routeC = routes![2]!
      const viaA = getViaPoint(routeA)!
      const viaB = getViaPoint(routeB)!
      const viaDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)

      return [
        ...(routeC.route.length === 2 &&
        routeC.route.every((point) => point.z === 0)
          ? [
              {
                type: "pcb_trace_error",
                error_type: "pcb_trace_error",
                pcb_trace_id: "net_c_0",
                pcb_trace_error_id: "overlap_net_c_0_obstacle",
                center: { x: 0, y: -1 },
              },
            ]
          : []),
        ...(viaDistance < 0.4
          ? [
              {
                type: "pcb_via_clearance_error",
                error_type: "pcb_via_clearance_error",
                pcb_error_id: "different_net_vias_close_via_0_via_1",
                pcb_via_ids: ["via_0", "via_1"],
                pcb_via_pair_net_relation: "different_net",
                center: {
                  x: (viaA.x + viaB.x) / 2,
                  y: (viaA.y + viaB.y) / 2,
                },
              },
            ]
          : []),
      ]
    },
  })

  solver.solve()

  const outputRoutes = solver.getOutput()
  const viaA = getViaPoint(outputRoutes[0]!)!
  const viaB = getViaPoint(outputRoutes[1]!)!
  expect(Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)).toBeGreaterThanOrEqual(
    0.4,
  )
})
