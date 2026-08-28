import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson } from "../lib/types"

test("connectivity memoization preserves ordered alias semantics per engine", () => {
  const connMap = new ConnectivityMap({
    other_net: ["trace_alias"],
    trace_alias: ["pad_alias"],
    resolved_net: ["resolve_alias"],
  })
  const originalGetNetConnectedToId = connMap.getNetConnectedToId.bind(connMap)
  const originalAreIdsConnected = connMap.areIdsConnected.bind(connMap)
  let getNetConnectedToIdCalls = 0
  let areIdsConnectedCalls = 0
  connMap.getNetConnectedToId = (id: string): string | undefined => {
    getNetConnectedToIdCalls += 1
    return originalGetNetConnectedToId(id)
  }
  connMap.areIdsConnected = (left: string, right: string): boolean => {
    areIdsConnectedCalls += 1
    return originalAreIdsConnected(left, right)
  }

  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const firstEngine = new AutoroutingDrcEngine(srj, { connMap }) as any

  expect(firstEngine.areConnected("trace_alias", "pad_alias")).toBe(true)
  const callsAfterFirstPair = {
    getNetConnectedToIdCalls,
    areIdsConnectedCalls,
  }
  expect(firstEngine.areConnected("trace_alias", "pad_alias")).toBe(true)
  expect({ getNetConnectedToIdCalls, areIdsConnectedCalls }).toEqual(
    callsAfterFirstPair,
  )

  expect(firstEngine.areConnected("pad_alias", "trace_alias")).toBe(false)
  expect(firstEngine.resolveNetId("resolve_alias")).toBe("resolved_net")
  const callsAfterFirstResolution = getNetConnectedToIdCalls
  expect(firstEngine.resolveNetId("resolve_alias")).toBe("resolved_net")
  expect(getNetConnectedToIdCalls).toBe(callsAfterFirstResolution)

  const secondEngine = new AutoroutingDrcEngine(srj, { connMap }) as any
  const callsBeforeSecondEngine = areIdsConnectedCalls
  expect(secondEngine.areConnected("trace_alias", "pad_alias")).toBe(true)
  expect(areIdsConnectedCalls).toBe(callsBeforeSecondEngine + 1)
})
