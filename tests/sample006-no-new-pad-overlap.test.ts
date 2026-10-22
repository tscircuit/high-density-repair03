import { beforeAll, expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getPhysicalSmtPadOverlaps } from "./fixtures/getPhysicalSmtPadOverlaps"
import input from "./fixtures/sample006-before-global-repair.json"

let outputPadOverlaps: ReturnType<typeof getPhysicalSmtPadOverlaps>

// Hook failures fail CI normally, independently of the expected regression.
beforeAll(() => {
  const srj = structuredClone(input.srj) as SimpleRouteJson
  const hdRoutes = structuredClone(input.hdRoutes) as HighDensityRoute[]
  const connMap = new ConnectivityMap(input.netMap)
  const getPadOverlaps = (routes: HighDensityRoute[]) =>
    getPhysicalSmtPadOverlaps(srj, routes, connMap)

  expect(getPadOverlaps(hdRoutes)).toEqual([])
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    effort: input.effort,
    maxIterations: input.maxIterations,
    enableLargeBoardBroadFallback: input.enableLargeBoardBroadFallback,
    enablePostSolveClearanceRelaxation:
      input.enablePostSolveClearanceRelaxation,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toHaveLength(hdRoutes.length)
  outputPadOverlaps = getPadOverlaps(solver.getOutput())
})

test("sample006 repair does not introduce a different-net SMT pad overlap", () => {
  expect(outputPadOverlaps).toEqual([])
})
