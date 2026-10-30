import { expect, test } from "bun:test"
import { TraceContactRepairSolver } from "../lib"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("local contact repair preserves independent progress when caller DRC omits a short", () => {
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
  const candidate = structuredClone(hdRoutes)
  candidate[0]!.route[1]!.y = 0.8
  candidate[4]!.route[1]!.y = 3.2
  const original = structuredClone(candidate)
  const solver = new TraceContactRepairSolver({
    srj,
    hdRoutes: candidate,
    inputHdRoutes: hdRoutes,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    drcEvaluator: ({ routes }) => ({
      errors: routes![4]!.route[1]!.y === 3 ? [{ type: "clearance" }] : [],
      errorsWithCenters: [],
    }),
  })
  solver.solve()
  const output = solver.getOutput()
  const previousPairs = new Set(getPhysicalPeerPairs(hdRoutes))
  expect(
    getPhysicalPeerPairs(output).filter((pair) => !previousPairs.has(pair)),
  ).toEqual([])
  expect(output[4]).toEqual(candidate[4])
  expect(candidate).toEqual(original)
  expect(solver.stats.traceContactRepairAccepted).toBe(true)
})
