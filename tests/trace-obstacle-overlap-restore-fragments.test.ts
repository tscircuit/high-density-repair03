import { expect, test } from "bun:test"
import { restoreOverlappingConnections } from "../lib/solvers/GlobalDrcForceImproveSolver/restoreOverlappingConnections"
import { identityRoute } from "./fixtures/traceObstacleIdentityFixtures"
import { snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("connection restoration preserves every safe fragment and unrelated route", () => {
  const checkpointRoutes = [
    identityRoute({ startX: -2, endX: -1, y: 1 }),
    identityRoute({ startX: -1, endX: 2, y: 1 }),
  ]
  const unrelated = identityRoute({ connectionName: "net_b", y: 2 })
  const routes = [unrelated, identityRoute()]
  const candidateSnapshot = {
    ...snapshot([
      {
        type: "pcb_trace_error",
        pcb_trace_id: "net_a_0",
        pcb_smtpad_id: "foreign_pad",
        actual_clearance: -0.04,
      },
    ]),
    traceConnectionNameById: new Map([["net_a_0", "net_a"]]),
  }
  const restored = restoreOverlappingConnections({
    routes,
    snapshot: candidateSnapshot,
    inputSnapshot: snapshot([]),
    checkpointRoutes,
  })
  expect(restored?.routes).toEqual([unrelated, ...checkpointRoutes])
  expect(restored?.restoredConnectionCount).toBe(1)
  expect(routes).toHaveLength(2)
  expect(
    restoreOverlappingConnections({
      routes,
      snapshot: { ...candidateSnapshot, traceConnectionNameById: undefined },
      inputSnapshot: snapshot([]),
      checkpointRoutes,
    }),
  ).toBeUndefined()
  expect(
    restoreOverlappingConnections({
      routes,
      snapshot: candidateSnapshot,
      inputSnapshot: snapshot([]),
      checkpointRoutes: [],
    }),
  ).toBeUndefined()
})
