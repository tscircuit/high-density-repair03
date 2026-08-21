import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

const getSegmentXAtY = (route: HighDensityRoute, y: number) => {
  const segment = route.route
    .slice(0, -1)
    .map((start, startIndex) => ({
      start,
      end: route.route[startIndex + 1]!,
    }))
    .filter(
      ({ start, end }) =>
        Math.abs(end.y - start.y) > 1e-9 &&
        y >= Math.min(start.y, end.y) - 1e-9 &&
        y <= Math.max(start.y, end.y) + 1e-9,
    )
    .sort(
      (left, right) =>
        Math.abs(right.end.y - right.start.y) -
        Math.abs(left.end.y - left.start.y),
    )[0]!
  const { start, end } = segment
  const t = (y - start.y) / (end.y - start.y)
  return start.x + (end.x - start.x) * t
}

test("propagates a trace-pair displacement into a newly constrained via", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -3, maxX: 2, maxY: 3 },
    connections: ["net_a", "net_b", "net_c"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      route: [
        { x: 0, y: -2, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1.5, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_b",
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: -0.12, y: 0.5, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "net_c",
      route: [
        { x: 0.8, y: -1, z: 1 },
        { x: 0.31, y: 0, z: 1 },
        { x: 0.31, y: 0, z: 0 },
        { x: 0.8, y: 1, z: 0 },
      ],
      vias: [{ x: 0.31, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes![0]!
    const routeB = routes![1]!
    const routeC = routes![2]!
    const errors: Array<Record<string, unknown>> = []
    const traceContactY = 0.5
    const traceAX = getSegmentXAtY(routeA, traceContactY)
    const traceBX = Math.max(...routeB.route.map(({ x }) => x))
    const traceEdgeGap = Math.abs(traceAX - traceBX) - 0.1
    if (traceEdgeGap < 0.1 - 1e-9) {
      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "net_a_0",
        pcb_trace_error_id: "overlap_net_a_0_net_b_0",
        minimum_clearance: 0.1,
        actual_clearance: traceEdgeGap,
        worst_actual_clearance: traceEdgeGap,
        center: {
          x: (traceAX + traceBX) / 2,
          y: traceContactY,
        },
        worst_contact_center: {
          x: (traceAX + traceBX) / 2,
          y: traceContactY,
        },
      })
    }

    const viaPoint = routeC.route.find((point, pointIndex) => {
      const next = routeC.route[pointIndex + 1]
      return (
        next &&
        point.z !== next.z &&
        Math.abs(point.x - next.x) < 1e-9 &&
        Math.abs(point.y - next.y) < 1e-9
      )
    })!
    const viaX = viaPoint.x
    const viaContactY = 0
    const viaTraceX = getSegmentXAtY(routeA, viaContactY)
    const viaEdgeGap = Math.abs(viaX - viaTraceX) - 0.2
    if (viaEdgeGap < 0.1 - 1e-9) {
      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "net_a_0",
        pcb_trace_error_id: "overlap_net_a_0_via_test",
        message: 'PCB trace net_a_0 is too close to pcb_via "via_test"',
        minimum_clearance: 0.1,
        actual_clearance: viaEdgeGap,
        worst_actual_clearance: viaEdgeGap,
        center: {
          x: (viaX + viaTraceX) / 2,
          y: viaContactY,
        },
        worst_contact_center: {
          x: (viaX + viaTraceX) / 2,
          y: viaContactY,
        },
      })
    }
    return { errors, errorsWithCenters: errors }
  }

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 4,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
  })
  solver.solve()

  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.globalDrcForceImproveBroadForceAccepted).toBe(false)
  expect(getSegmentXAtY(solver.getOutput()[0]!, 0.5)).toBeGreaterThan(0)
  expect(Math.max(...solver.getOutput()[2]!.route.map(({ x }) => x))).toBe(0.8)
  expect(
    solver
      .getOutput()[2]!
      .route.some(
        (point, pointIndex, points) =>
          point.x > 0.31 &&
          points[pointIndex + 1]?.z !== point.z &&
          points[pointIndex + 1]?.x === point.x,
      ),
  ).toBe(true)
})
