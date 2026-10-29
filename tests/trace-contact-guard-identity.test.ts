import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { createPeerTraceRepairInput } from "./fixtures/peerTraceRepair"

test("contact identity survives fragments and respects SRJ and connectivity-map nets", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const fragmented = hdRoutes
    .flatMap((route) => [
      { ...route, route: route.route.slice(0, 2) },
      { ...route, route: route.route.slice(1) },
    ])
    .reverse()
  expect(guard.getNewContactConnectionNames(fragmented).size).toBe(0)
  const candidate = structuredClone(hdRoutes)
  candidate[0]!.route[1]!.y = 0.8
  expect([...guard.getNewContactConnectionNames(candidate)].sort()).toEqual([
    "signal_1",
    "signal_4",
  ])
  for (const useMap of [false, true]) {
    const sharedSrj = structuredClone(srj)
    if (!useMap) {
      sharedSrj.connections[0]!.netConnectionName = "common"
      sharedSrj.connections[3]!.netConnectionName = "common"
    }
    const sharedGuard = new TraceContactGuard({
      srj: sharedSrj,
      inputRoutes: hdRoutes,
      connMap: useMap
        ? new ConnectivityMap({ common: ["signal_1", "signal_4"] })
        : undefined,
    })
    expect(sharedGuard.getNewContactConnectionNames(candidate).size).toBe(0)
  }
})
