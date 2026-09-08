import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { createImmutableGeometryFixture } from "./fixtures/immutable-geometry-fixture"
test("default trace and connMap mutation stays live and immutable geometry mode rejects a connMap", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const connMap = new ConnectivityMap({})
  const ordinary = new AutoroutingDrcEngine(srj, { connMap })
  const explicit = new AutoroutingDrcEngine(srj, {
    connMap,
    cacheImmutableTraceGeometry: false,
  })
  expect(explicit.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  for (const point of traces[0]!.route)
    if (point.route_type === "wire") point.y += 3
  connMap.addConnections([["a", "b", "pad_net"]])
  expect(explicit.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(explicit.lastRunStats).toEqual(ordinary.lastRunStats)
  expect(
    () =>
      new AutoroutingDrcEngine(srj, {
        connMap,
        cacheImmutableTraceGeometry: true,
      }),
  ).toThrow("cacheImmutableTraceGeometry cannot be combined with connMap")
  const fresh = new AutoroutingDrcEngine(srj, { connMap })
  expect(ordinary.evaluate(traces)).toEqual(fresh.evaluate(traces))
})
