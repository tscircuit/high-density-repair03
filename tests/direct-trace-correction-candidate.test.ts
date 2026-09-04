import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("a rejected direct trace correction is evaluated once rather than once per force scale", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      { name: "horizontal", pointsToConnect: [] },
      { name: "vertical", pointsToConnect: [] },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const inputGeometry = JSON.stringify(routes.map((route) => route.route))
  const candidateGeometries: string[] = []
  const engine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    maxIterations: 1,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: ({ traces, routes }) => {
      const geometry = JSON.stringify(routes!.map((route) => route.route))
      if (geometry !== inputGeometry) candidateGeometries.push(geometry)
      return engine.evaluate(traces)
    },
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
  expect(solver.stats.globalDrcForceImproveTargetedForceAccepted).toBe(false)
  expect(candidateGeometries).toHaveLength(1)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(1)
})
