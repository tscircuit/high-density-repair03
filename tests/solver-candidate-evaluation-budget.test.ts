import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("stops exact repair after the configured candidate evaluation budget", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 7 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 5 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["different_net"],
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
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 5, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 10, y: 5, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  let drcEvaluationCount = 0
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 32,
    maxCandidateEvaluations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: () => {
      drcEvaluationCount += 1
      return [
        {
          type: "pcb_trace_error",
          message: "pcb_trace overlaps pcb_smtpad",
          center: { x: 2, y: 5 },
          pcb_trace_id: "A_0",
        },
      ]
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(1)
  expect(drcEvaluationCount).toBe(3)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(2)
  expect(solver.stats.globalDrcForceImproveCandidateEvaluations).toBe(2)
  expect(
    solver.stats.globalDrcForceImproveCandidateEvaluationBudgetExhausted,
  ).toBe(true)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
})
