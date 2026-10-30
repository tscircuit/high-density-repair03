import { beforeAll, expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

let newContacts: string[]

beforeAll(() => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const original = structuredClone(hdRoutes)
  const before = getPhysicalPeerPairs(hdRoutes)
  expect(before).toHaveLength(4)
  expect(before).not.toContain('["signal_1","signal_4"]')
  expect(getDrcSnapshot(srj, hdRoutes).count).toBe(5)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  const output = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output).toHaveLength(hdRoutes.length)
  expect(getDrcSnapshot(srj, output).count).toBeLessThanOrEqual(5)
  expect(hdRoutes).toEqual(original)
  for (let i = 0; i < output.length; i++) {
    expect(output[i]!.route[0]).toEqual(original[i]!.route[0])
    expect(output[i]!.route.at(-1)).toEqual(original[i]!.route.at(-1))
  }
  newContacts = getPhysicalPeerPairs(output).filter(
    (pair) => !before.includes(pair),
  )
})

test.failing("repair cannot trade fewer DRC errors for a new short between traces", () => {
  expect(newContacts).toEqual([])
})
