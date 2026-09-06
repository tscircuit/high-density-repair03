import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  createImmutableGeometryFixture,
  wire,
  via,
} from "./fixtures/immutable-geometry-fixture"
test("immutable spatial reuse preserves ordered contacts, repeated clear pairs, alias collisions and exact statistics across candidate states", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  srj.connections = [
    { name: "a", rootConnectionName: "alias", pointsToConnect: [] },
    { name: "alias", rootConnectionName: "pad_net", pointsToConnect: [] },
  ]
  const ordinary = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
    spatialCellSize: 0.13,
  })
  const cached = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
    spatialCellSize: 0.13,
    cacheStaticObstacleNetMembership: true,
    cacheImmutableTraceGeometry: true,
  })
  expect(cached.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
  expect(cached.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
  const original = structuredClone(traces)
  const changed = [
    wire(
      "same_id",
      "unknown",
      [
        [-2, 0.4],
        [0, 0.2],
        [2, 0.4],
      ],
      0.2,
    ),
    ...traces.slice(1),
  ]
  const states = [
    traces,
    traces,
    changed,
    traces,
    [...traces].reverse(),
    [
      wire("prefix", "new", [
        [-4, -4],
        [-3, -4],
      ]),
      ...traces,
    ],
    traces,
    [...traces, via("reverse", "q", 0.08, 0.05, "inner1", "top", 0.4)],
    traces,
  ]
  for (const state of states)
    for (const method of ["evaluate", "evaluateLegacy"] as const) {
      expect(cached[method](state)).toEqual(ordinary[method](state))
      expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    }
  expect(ordinary.evaluate(traces).errors.length).toBeGreaterThan(2)
  expect(traces).toEqual(original)
})
