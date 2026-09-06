import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  createImmutableGeometryFixture,
  via,
  wire,
} from "./fixtures/immutable-geometry-fixture"

test("transient query markers preserve first encounter order across cells, layers and repeated trace objects", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  traces.push(
    wire(
      "inner",
      "inner_net",
      [
        [-2, 0],
        [2, 0],
      ],
      0.15,
      "inner1",
    ),
  )
  const options = {
    spatialCellSize: 0.13,
    cacheImmutableTraceGeometry: true,
    cacheStaticObstacleNetMembership: true,
    useConservativeRectObstaclePrecheck: true,
    includeTraceViaOwnerMetadata: true,
  }
  const control = new AutoroutingDrcEngine(srj, options)
  const fast = new AutoroutingDrcEngine(srj, {
    ...options,
    useTransientDynamicQueryMarkers: true,
  })
  const inspected = fast as any
  const states = [
    traces,
    [...traces].reverse(),
    [traces[0]!, ...traces],
    [
      via("new_owner", "different", 0.08, 0.05, "top", "inner1", 0.8),
      ...traces,
    ],
    [],
    traces,
  ]
  let redundantMemberships = 0
  let multilayerViaEncounters = 0
  for (const state of states) {
    expect(fast.evaluate(state)).toEqual(control.evaluate(state))
    expect(fast.lastRunStats).toEqual(control.lastRunStats)
    expect(fast.evaluateLegacy(state)).toEqual(control.evaluateLegacy(state))
    expect(fast.lastRunStats).toEqual(control.lastRunStats)
    const { segments, vias } = inspected.collectDynamicGeometry(state)
    const indexes = inspected.buildDynamicIndexes(segments, vias)
    for (const entity of [...segments, ...vias])
      expect(entity.lastDynamicQueryOrder).toBeUndefined()
    for (const segment of segments) {
      const keys = inspected.immutableDynamicQueryCellKeys.get(
        segment.geometryKey,
      )
      const index = indexes.get(segment.layer)
      const expected = index.queryWithCellKeys(keys)
      const actual = index.queryWithCellKeysUsingOrder(keys, segment.order)
      expect(actual.length).toBe(expected.length)
      for (let i = 0; i < actual.length; i++)
        expect(actual[i]).toBe(expected[i])
      redundantMemberships +=
        keys.reduce(
          (sum: number, key: string) =>
            sum + (index.cells.get(key)?.length ?? 0),
          0,
        ) - actual.length
      if (segment.layer === "inner1")
        multilayerViaEncounters += actual.filter(
          (x: any) => x.kind === "via" && x.layers.includes("top"),
        ).length
      expect(Object.hasOwn(segment.geometryKey, "lastDynamicQueryOrder")).toBe(
        false,
      )
    }
    for (const v of vias)
      expect(Object.hasOwn(v.geometryKey, "lastDynamicQueryOrder")).toBe(false)
  }
  expect(redundantMemberships).toBeGreaterThan(100)
  expect(multilayerViaEncounters).toBeGreaterThan(0)
})
