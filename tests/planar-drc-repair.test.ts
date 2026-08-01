import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

const getViaCenters = (routes: HighDensityRoute[]) =>
  routes.flatMap((route) =>
    route.route.flatMap((point, pointIndex) => {
      const nextPoint = route.route[pointIndex + 1]
      return nextPoint &&
        point.z !== nextPoint.z &&
        point.x === nextPoint.x &&
        point.y === nextPoint.y
        ? [{ x: point.x, y: point.y }]
        : []
    }),
  )

test("repairs exact planar trace and overlapping same-net via errors", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: [
      { name: "trace_a", pointsToConnect: [] },
      { name: "trace_b", pointsToConnect: [] },
      { name: "via_a", pointsToConnect: [] },
      { name: "via_b", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace_a",
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "trace_b",
      route: [
        { x: 0, y: -0.2, z: 0 },
        { x: 0, y: 0.2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "via_a",
      route: [
        { x: -2, y: -2, z: 0 },
        { x: -1, y: -2, z: 0 },
        { x: -1, y: -2, z: 1 },
        { x: 0, y: -2, z: 1 },
      ],
      vias: [{ x: -1, y: -2 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "via_b",
      route: [
        { x: -2, y: -1.5, z: 0 },
        { x: -0.95, y: -2, z: 0 },
        { x: -0.95, y: -2, z: 1 },
        { x: 0, y: -1.5, z: 1 },
      ],
      vias: [{ x: -0.95, y: -2 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const errors: Array<Record<string, unknown>> = []
    if (candidateRoutes[0]?.route.length === 2) {
      errors.push({
        type: "pcb_trace_error",
        pcb_trace_id: "trace_a_0",
        pcb_trace_ids: ["trace_a_0", "trace_b_0"],
        pcb_trace_error_id: "overlap_trace_a_0_trace_b_0",
        center: { x: 0, y: 0 },
        message: "Trace pair overlaps",
      })
    }

    const [leftVia, rightVia] = getViaCenters(candidateRoutes)
    if (
      leftVia &&
      rightVia &&
      Math.hypot(leftVia.x - rightVia.x, leftVia.y - rightVia.y) > 1e-3
    ) {
      errors.push({
        type: "pcb_via_clearance_error",
        error_type: "pcb_via_clearance_error",
        pcb_error_id: "same_net_vias_close_via_0_via_1",
        pcb_via_ids: ["via_0", "via_1"],
        center: {
          x: (leftVia.x + rightVia.x) / 2,
          y: (leftVia.y + rightVia.y) / 2,
        },
        message: "Same-net vias overlap",
      })
    }
    return { errors, errorsWithCenters: errors }
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["via_a", "shared_via_net"],
    ["via_b", "shared_via_net"],
  ])
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    drcEvaluator,
    maxIterations: 8,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[0]?.route.length).toBeGreaterThan(2)
  expect(getViaCenters(solver.getOutput())).toEqual([
    { x: -1, y: -2 },
    { x: -1, y: -2 },
  ])
  expect(solver.getOutput()[2]?.route[0]).toEqual(hdRoutes[2]?.route[0])
  expect(solver.getOutput()[3]?.route.at(-1)).toEqual(hdRoutes[3]?.route.at(-1))

  const graphics = solver.visualize()
  expect(
    new Set([
      ...(graphics.lines ?? []).map((line) => line.step),
      ...(graphics.circles ?? []).map((circle) => circle.step),
      ...(graphics.texts ?? []).map((text) => text.step),
    ]),
  ).toEqual(new Set([1, 2]))
  expect(graphics.texts?.map((text) => text.text)).toEqual([
    "Before repair: 2 DRC errors",
    "After repair: 0 DRC errors",
  ])
})
