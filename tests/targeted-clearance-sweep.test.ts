import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

test("repairs multiple exact geometry errors in one accepted sweep", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 6 },
    connections: [
      { name: "A", pointsToConnect: [] },
      { name: "B", pointsToConnect: [] },
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
      {
        type: "rect",
        center: { x: 8, y: 4 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_b", "foreign_b"],
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
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 4, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 10, y: 4, z: 0 },
        { x: 10, y: 5, z: 0 },
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
    if (Math.abs((routes?.[1]?.route[1]?.y ?? 4) - 4) < 0.2) {
      errors.push({
        type: "pcb_trace_error",
        message:
          'PCB trace trace[B] overlaps with pcb_smtpad "port_b" (accidental contact)',
        center: { x: 8, y: 4 },
        pcb_trace_id: "B_0",
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
  })

  solver.solve()

  const output = solver.getOutput()
  expect(drcEvaluator({ traces: [], routes: output })).toEqual([])
  expect(output[0]?.route[1]?.y).toBeGreaterThanOrEqual(0.2)
  expect(Math.abs((output[1]?.route[1]?.y ?? 4) - 4)).toBeGreaterThanOrEqual(
    0.2,
  )
})

test("can preserve an already clean route without post-solve relaxation", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator: () => [],
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.getOutput()).toBe(hdRoutes)
  expect(
    solver.getConstructorParams()[0].enablePostSolveClearanceRelaxation,
  ).toBe(false)
})

test("rejects post-solve relaxation that introduces a DRC error", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["foreign_pad"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  let sawRelaxedCandidate = false
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const middleY = routes?.[0]?.route[1]?.y ?? 0
    if (Math.abs(middleY) < 1e-9) return []
    sawRelaxedCandidate = true
    return [
      {
        type: "pcb_trace_error",
        message: "relaxation introduced a synthetic conflict",
        center: { x: 0, y: middleY },
      },
    ]
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
  })

  solver.solve()

  expect(sawRelaxedCandidate).toBe(true)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()).toBe(hdRoutes)
})
