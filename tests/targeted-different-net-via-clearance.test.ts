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

test("limits different-net via priority so trace topology still progresses", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 3, maxY: 2 },
    connections: ["net_a", "net_b", "net_d", "net_e", "net_c"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const createViaRoute = (
    connectionName: string,
    viaX: number,
  ): HighDensityRoute => ({
    connectionName,
    route: [
      { x: viaX - 0.5, y: 0, z: 0 },
      { x: viaX, y: 0, z: 0 },
      { x: viaX, y: 0, z: 1 },
      { x: viaX + 0.5, y: 0, z: 1 },
    ],
    vias: [{ x: viaX, y: 0 }],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  const inputRoutes: HighDensityRoute[] = [
    createViaRoute("net_a", 0),
    createViaRoute("net_b", 0.05),
    createViaRoute("net_d", 1),
    createViaRoute("net_e", 1.05),
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
    maxIterations: 2,
    enableBroadFallback: false,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    drcEvaluator: ({ routes }) => {
      const candidateRoutes = routes!
      const getPairError = (
        leftRouteIndex: number,
        rightRouteIndex: number,
        pairIndex: number,
      ) => {
        const leftVia = getViaPoint(candidateRoutes[leftRouteIndex]!)!
        const rightVia = getViaPoint(candidateRoutes[rightRouteIndex]!)!
        if (Math.hypot(leftVia.x - rightVia.x, leftVia.y - rightVia.y) >= 0.4)
          return []
        return [
          {
            type: "pcb_via_clearance_error",
            error_type: "pcb_via_clearance_error",
            pcb_error_id: `different_net_vias_close_pair_${pairIndex}`,
            pcb_via_ids: [`via_${pairIndex * 2}`, `via_${pairIndex * 2 + 1}`],
            pcb_via_pair_net_relation: "different_net",
            center: {
              x: (leftVia.x + rightVia.x) / 2,
              y: (leftVia.y + rightVia.y) / 2,
            },
          },
        ]
      }
      const traceRoute = candidateRoutes[4]!

      return [
        ...(traceRoute.route.length === 2 &&
        traceRoute.route.every((point) => point.z === 0)
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
        ...getPairError(0, 1, 0),
        ...getPairError(2, 3, 1),
      ]
    },
  })

  solver.solve()

  const outputRoutes = solver.getOutput()
  const firstPairDistance = Math.hypot(
    getViaPoint(outputRoutes[0]!)!.x - getViaPoint(outputRoutes[1]!)!.x,
    getViaPoint(outputRoutes[0]!)!.y - getViaPoint(outputRoutes[1]!)!.y,
  )
  expect(firstPairDistance).toBeGreaterThanOrEqual(0.4)
  expect(outputRoutes[4]!.route.length).toBeGreaterThan(2)
})
