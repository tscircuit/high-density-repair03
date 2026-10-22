import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  getDrcSnapshot,
  hasNewTraceObstacleOverlaps,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("solar repair retains independent improvements when rejecting a new pad short", () => {
  const input: {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
    netMap: Record<string, string[]>
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/solar-before-global-repair.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const connMap = new ConnectivityMap(input.netMap)
  const solver = new GlobalDrcForceImproveSolver({
    srj: input.srj,
    hdRoutes: input.hdRoutes,
    connMap,
    effort: 1,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  const before = getDrcSnapshot(
    input.srj,
    input.hdRoutes,
    undefined,
    connMap,
    solver.autoroutingDrcEngine,
  )
  const after = getDrcSnapshot(
    input.srj,
    solver.getOutput(),
    undefined,
    connMap,
    solver.autoroutingDrcEngine,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(hasNewTraceObstacleOverlaps(after, before)).toBe(false)
  // The rejected four-error candidate shorts a pad. Keeping the unaffected
  // repairs leaves five errors instead of restoring all 29 input errors.
  expect(after.count).toBeLessThanOrEqual(5)
  expect(
    solver
      .getOutput()
      .find((route) => route.connectionName === "source_net_25"),
  ).toEqual(
    input.hdRoutes.find((route) => route.connectionName === "source_net_25"),
  )
})
