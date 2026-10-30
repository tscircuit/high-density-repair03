import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver, TraceContactRepairSolver } from "../lib"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("an owning pipeline repairs contacts deferred by an intermediate solver", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const originalPairs = new Set(getPhysicalPeerPairs(hdRoutes))
  const intermediate = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    deferTraceContactGuard: true,
  })
  intermediate.solve()
  expect(
    getPhysicalPeerPairs(intermediate.getOutput()).some(
      (pair) => !originalPairs.has(pair),
    ),
  ).toBe(true)
  const owner = new TraceContactRepairSolver({
    srj,
    hdRoutes: intermediate.getOutput(),
    inputHdRoutes: hdRoutes,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  owner.solve()
  expect(
    getPhysicalPeerPairs(owner.getOutput()).filter(
      (pair) => !originalPairs.has(pair),
    ),
  ).toEqual([])
  expect(hdRoutes).toEqual(createPeerTraceRepairInput().hdRoutes)
})
