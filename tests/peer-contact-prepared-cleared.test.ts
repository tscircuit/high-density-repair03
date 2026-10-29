import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createPeerTraceRepairInput } from "./fixtures/peerTraceRepair"

test("prepared checks observe contacts cleared after their reference snapshot", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  hdRoutes[0]!.route[1]!.y = 0.8
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const check = guard.prepareCandidateCheck(hdRoutes)
  expect(check(hdRoutes)).toEqual([])
  const cleared = structuredClone(hdRoutes)
  cleared[0]!.route.forEach((point) => {
    point.z = 1
  })
  guard.preserveClearedContacts(cleared)
  expect(check(hdRoutes).length).toBeGreaterThan(0)
  expect(check(hdRoutes)).toEqual(guard.getNewContactPairs(hdRoutes))
})
