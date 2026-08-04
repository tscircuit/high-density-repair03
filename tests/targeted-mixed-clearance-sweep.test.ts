import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

test("repairs mixed trace and via-trace errors in one targeted sweep", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 3 },
    connections: [
      { name: "A", pointsToConnect: [] },
      { name: "B", pointsToConnect: [] },
      { name: "C", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_a", "foreign_a"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: -1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "B",
      route: [
        { x: 7, y: 1, z: 0 },
        { x: 8, y: 1, z: 0 },
        { x: 8, y: 1, z: 1 },
        { x: 9, y: 1, z: 1 },
      ],
      vias: [{ x: 8, y: 1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "C",
      route: [
        { x: 7, y: 0.8, z: 0 },
        { x: 8, y: 0.8, z: 0 },
        { x: 9, y: 0.8, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Record<string, unknown>[] = []
    if ((routes?.[0]?.route[1]?.y ?? 0) < 0.2) {
      errors.push({
        type: "pcb_trace_error",
        message:
          'PCB trace trace[A] overlaps with pcb_smtpad "port_a" (accidental contact)',
        center: { x: 2, y: 0 },
        pcb_trace_id: "A_0",
      })
    }

    const viaPoint = routes?.[1]?.route[1]
    const tracePoint = routes?.[2]?.route[1]
    if (
      viaPoint &&
      tracePoint &&
      Math.hypot(viaPoint.x - tracePoint.x, viaPoint.y - tracePoint.y) < 0.3
    ) {
      errors.push({
        type: "pcb_via_trace_clearance_error",
        center: {
          x: (viaPoint.x + tracePoint.x) / 2,
          y: (viaPoint.y + tracePoint.y) / 2,
        },
        pcb_via_id: "via_0",
        pcb_trace_id: "C_0",
      })
    }
    return errors
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
  })

  expect(drcEvaluator({ traces: [], routes: hdRoutes })).toHaveLength(2)

  solver.solve()

  expect(drcEvaluator({ traces: [], routes: solver.getOutput() })).toEqual([])
})
