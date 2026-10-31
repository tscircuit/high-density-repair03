import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceContactGuard } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("via copper respects connectivity aliases and records cleared contacts", () => {
  const { srj, hdRoutes } = createViaContactGuardInput()
  const touching = structuredClone(hdRoutes)
  for (const point of touching[1]!.route) point.y = 0.19
  touching[1]!.vias[0]!.y = 0.19
  for (const useMap of [false, true]) {
    const sameNetSrj = structuredClone(srj)
    if (!useMap) {
      for (const connection of sameNetSrj.connections)
        connection.netConnectionName = "shared"
    }
    const guard = new TraceContactGuard({
      srj: sameNetSrj,
      inputRoutes: hdRoutes,
      connMap: useMap
        ? new ConnectivityMap({ shared: ["wire", "via"] })
        : undefined,
    })
    expect(guard.getNewContactPairs(touching)).toEqual([])
  }
  const guard = new TraceContactGuard({ srj, inputRoutes: touching })
  const check = guard.prepareCandidateCheck(touching)
  expect(guard.getNewContactPairs(touching)).toEqual([])
  guard.preserveClearedContacts(hdRoutes)
  expect(guard.getNewContactPairs(touching)).toEqual([["via", "wire"]])
  expect(check(touching)).toEqual([["via", "wire"]])
})
