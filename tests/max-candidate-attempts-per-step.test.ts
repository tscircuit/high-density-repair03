import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("bounds candidate attempts independently from effort", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "route_0", pointsToConnect: [] },
      { name: "route_1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "route_0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "route_1",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const solverParams = {
    srj,
    hdRoutes,
    autoroutingDrcEngine: new AutoroutingDrcEngine(srj),
    effort: 5,
    maxIterations: 2,
    maxCandidateAttemptsPerStep: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  }

  expect(
    () =>
      new GlobalDrcForceImproveSolver({
        ...solverParams,
        maxCandidateAttemptsPerStep: 0,
      }),
  ).toThrow("maxCandidateAttemptsPerStep must be a positive integer")

  const solver = new GlobalDrcForceImproveSolver(solverParams)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.globalDrcForceImproveMaxCandidateAttemptsPerStep).toBe(1)
  expect(
    solver.stats.globalDrcForceImproveCandidateAttempts,
  ).toBeLessThanOrEqual(2)
})
