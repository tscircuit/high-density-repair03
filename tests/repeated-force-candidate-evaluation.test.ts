import { beforeAll, expect, spyOn, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

let nativeEvaluationCount = 0

beforeAll(() => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 2 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    connections: [{ name: "signal", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
    },
  ]
  const original = structuredClone(hdRoutes)
  const engine = new AutoroutingDrcEngine(srj)
  const evaluate = spyOn(engine, "evaluate")
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    autoroutingDrcEngine: engine,
    maxIterations: 16,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  })
  try {
    solver.solve()
    // The fixed endpoint remains in the foreign pad. Search must preserve the
    // input and its one existing error, not trade it for an unsafe output.
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(hdRoutes).toEqual(original)
    expect(solver.getOutput()).toEqual(original)
    expect(solver.stats.initialDrcIssueCount).toBe(1)
    expect(solver.stats.finalDrcIssueCount).toBe(1)
    expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(6)
    nativeEvaluationCount = evaluate.mock.calls.length
  } finally {
    evaluate.mockRestore()
  }
})

test.failing("equal force-scale candidates do not repeat native DRC work", () => {
  // Two initial policies and one distinct rejected candidate per iteration.
  // Main evaluates that same rejected geometry three times per iteration.
  expect(nativeEvaluationCount).toBeLessThanOrEqual(4)
})
