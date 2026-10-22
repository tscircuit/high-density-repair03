import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  identityRoute,
  identitySnapshot,
} from "./fixtures/traceObstacleIdentityFixtures"

test("logical overlap identities distinguish new pads and connections sharing a net", () => {
  const before = identitySnapshot([identityRoute()])
  for (const candidate of [
    identityRoute({
      connectionName: "net_a",
      startX: 2,
      endX: 4,
    }),
    identityRoute({
      connectionName: "net_b",
    }),
  ]) {
    const after = identitySnapshot([candidate])
    expect(after.count).toBe(1)
    expect(hasNewTraceObstacleOverlaps(after, before)).toBe(true)
  }
})
