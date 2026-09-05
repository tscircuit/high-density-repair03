import { expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import {
  AutoroutingDrcEngine,
  GlobalDrcBranchPortfolioSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"
import input from "./fixtures/srj18-sample9-repair-input.json"

test("repairs SRJ18 sample 9 with original pads and safe layer transitions", () => {
  const { srj, hdRoutes } = structuredClone(input) as {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const engine = new AutoroutingDrcEngine(srj, {
    connMap,
    includeTraceViaOwnerMetadata: true,
  })
  expect(
    getDrcSnapshot(srj, hdRoutes, undefined, connMap, engine).errors,
  ).toHaveLength(16)
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    connMap,
    autoroutingDrcEngine: engine,
    maxIterations: 32,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enableTraceViaOwnerTargeting: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    viaInPadMaxIterations: 32,
    broadMaxIterations: 12,
    broadPassMultiplier: 3,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, connMap, engine).errors,
  ).toEqual([])
  expectSrjRepairSnapshot(srj, hdRoutes, solver.getOutput(), import.meta.path)
})
