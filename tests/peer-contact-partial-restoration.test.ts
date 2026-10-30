import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type HighDensityRoute } from "../lib"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("geometric publication checks retain unrelated repairs when external DRC omits a short", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  srj.bounds.maxY = 4
  hdRoutes.push({
    ...structuredClone(hdRoutes[0]!),
    connectionName: "independent",
    route: [
      { x: 0, y: 3, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 3, y: 3, z: 0 },
    ],
  })
  srj.connections.push({ name: "independent", pointsToConnect: [] })
  const referenceInputs: HighDensityRoute[][] = []
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    enablePostSolveClearanceRelaxation: false,
    drcEvaluator: ({ routes }) => ({
      errors:
        routes![4]!.route[1]!.y === 3
          ? Array.from({ length: 3 }, () => ({ type: "clearance" }))
          : [],
      errorsWithCenters: [],
    }),
    referenceDrcEvaluator: ({ routes }) => {
      referenceInputs.push(structuredClone(routes!))
      return []
    },
  })
  const candidate = structuredClone(hdRoutes)
  candidate[0]!.route[1]!.y = 0.8
  candidate[4]!.route[1]!.y = 3.2
  solver.outputHdRoutes = candidate
  solver.tryFinalAcceptance()
  const output = solver.getOutput()
  expect(output[0]).toEqual(hdRoutes[0])
  expect(output[3]).toEqual(hdRoutes[3])
  expect(output[4]).toEqual(candidate[4])
  expect(referenceInputs.at(-1)).toEqual(output)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.globalDrcForceImprovePeerTraceRepairRolledBack).toBe(true)
  expect(
    solver.stats.globalDrcForceImproveOverlapRestorationChecks,
  ).toBeLessThanOrEqual(2)
  const originalContacts = getPhysicalPeerPairs(hdRoutes)
  expect(
    getPhysicalPeerPairs(output).filter(
      (pair) => !originalContacts.includes(pair),
    ),
  ).toEqual([])
})
