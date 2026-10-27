import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  getDrcSnapshot,
  hasNewTraceCopperOverlaps,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("legacy-clean checkpoint admission cannot hide a newly introduced peer short", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 2, y: -1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.2,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: false,
    drcEvaluator: () => [{ type: "clearance" }, { type: "clearance" }],
  })
  solver.step()
  const state = solver as unknown as {
    outputHdRoutes: HighDensityRoute[]
    outputSnapshot: DrcSnapshot
    legacyCleanCheckpoint?: { routes: HighDensityRoute[] }
    inputSnapshot: DrcSnapshot
  }
  expect(state.inputSnapshot).toBeDefined()
  // Exercise checkpoint admission at a later externally evaluated state.
  solver.solved = false
  const candidate = structuredClone(routes)
  candidate[1]!.route[1]!.x = 0
  const reportedViaPadDebt = getDrcSnapshot(srj, candidate, () => [
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_via_ids: ["registered-via"],
    },
  ])
  state.outputHdRoutes = candidate
  state.outputSnapshot = reportedViaPadDebt
  solver.step()
  expect(state.legacyCleanCheckpoint).toBeUndefined()
  solver.tryFinalAcceptance()
  expect(solver.solved).toBeTrue()
  expect(
    hasNewTraceCopperOverlaps(
      getDrcSnapshot(srj, solver.getOutput(), () => []),
      state.inputSnapshot,
      solver.getOutput(),
      routes,
    ),
  ).toBeFalse()
  expect(solver.getOutput()).toEqual(routes)
})
