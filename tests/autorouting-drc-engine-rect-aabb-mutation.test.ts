import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { wire } from "./fixtures/immutable-geometry-fixture"
import { createRectAabbFixture } from "./fixtures/rect-aabb-fixture"
test("default mode stays unchanged and rectangle prechecks preserve live trace and connectivity-map mutation", (): void => {
  const srj = createRectAabbFixture(),
    connMap = new ConnectivityMap({})
  const traces = [
    wire(
      "mutable",
      "trace_net",
      [
        [-2, 0.65],
        [2, 0.65],
      ],
      0.1,
    ),
  ]
  const ordinary = new AutoroutingDrcEngine(srj, { connMap })
  const explicitOff = new AutoroutingDrcEngine(srj, {
    connMap,
    useConservativeRectObstaclePrecheck: false,
  })
  const enabled = new AutoroutingDrcEngine(srj, {
    connMap,
    useConservativeRectObstaclePrecheck: true,
  })
  for (const y of [0.65, 0.56, 0.65, 0.56]) {
    for (const point of traces[0]!.route)
      if (point.route_type === "wire") point.y = y
    const expected = ordinary.evaluate(traces)
    expect(explicitOff.evaluate(traces)).toEqual(expected)
    expect(enabled.evaluate(traces)).toEqual(expected)
    expect(enabled.lastRunStats).toEqual(ordinary.lastRunStats)
    expect(expected.errors.length).toBe(y === 0.56 ? 1 : 0)
  }
  connMap.addConnections([["trace_net", "foreign_net"]])
  expect(enabled.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(enabled.lastRunStats).toEqual(ordinary.lastRunStats)
  expect(enabled.lastRunStats.exactCheckCount).toBe(0)
})
