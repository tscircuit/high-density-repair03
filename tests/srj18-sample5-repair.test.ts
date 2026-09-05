import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type GlobalDrcForceImproveSolverParams,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"

test("repairs captured SRJ18 sample 5 without losing terminal connections", async () => {
  const { params } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("../benchmarks/srj18/sample005.json.gz", import.meta.url),
      ),
    ).toString(),
  ) as { params: GlobalDrcForceImproveSolverParams }
  const { srj, hdRoutes } = params
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const engine = new AutoroutingDrcEngine(srj, { connMap })
  expect(
    getDrcSnapshot(srj, hdRoutes, undefined, connMap, engine).errors,
  ).toHaveLength(2)
  const solver = new GlobalDrcForceImproveSolver({
    ...params,
    connMap,
    autoroutingDrcEngine: engine,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, connMap, engine).errors,
  ).toEqual([])
  await expectSrjRepairSnapshot(
    srj,
    hdRoutes,
    solver.getOutput(),
    import.meta.path,
  )
})
