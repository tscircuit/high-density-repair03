import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("repairs an exact trace pair without enabling via-in-pad moves", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: 0, y: -0.2, z: 0 },
        { x: 0, y: 0.2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEngine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    autoroutingDrcEngine: drcEngine,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    enableViaInPadLayerMoves: false,
  })

  expect(getDrcSnapshot(srj, routes, undefined, undefined, drcEngine).count).toBe(
    1,
  )
  solver.solve()
  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, undefined, drcEngine)
      .count,
  ).toBe(0)
  expect(solver.getOutput().some((route) => route.route.length > 2)).toBe(true)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidateAttempts).toBe(0)
})
