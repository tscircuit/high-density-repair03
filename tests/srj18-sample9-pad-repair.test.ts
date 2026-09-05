import { expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"
import input from "./fixtures/srj18-sample9-repair-input.json"

test("captures the SRJ18 sample 9 layer-repair baseline", async () => {
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
  ).toHaveLength(23)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    autoroutingDrcEngine: engine,
    maxIterations: 32,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: false,
    enableTraceViaOwnerTargeting: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, connMap, engine).errors,
  ).toHaveLength(15)
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expectSrjRepairSnapshot(srj, hdRoutes, solver.getOutput(), snapshotPath)
})
