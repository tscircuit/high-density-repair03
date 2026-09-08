import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimplifiedPcbTraces } from "../lib/types"
import {
  createImmutableGeometryFixture,
  via,
  wire,
} from "./fixtures/immutable-geometry-fixture"

type Entity = { geometryKey?: object; [key: string]: unknown }
type Index = {
  cells: Map<string, Entity[]>
  query: (bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }) => Entity[]
}
type InspectedEngine = {
  obstacleIndexesByLayer: Map<string, Index>
  collectDynamicGeometry: (traces: SimplifiedPcbTraces) => {
    segments: Entity[]
    vias: Entity[]
  }
  buildDynamicIndexes: (
    segments: Entity[],
    vias: Entity[],
  ) => Map<string, Index>
  immutableDynamicCellKeys: WeakMap<object, readonly string[]>
}

test("immutable spatial reuse keeps fresh ordered buckets and query results when earlier traces or via owners change", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const ordinary = new AutoroutingDrcEngine(srj, { spatialCellSize: 0.13 })
  const cached = new AutoroutingDrcEngine(srj, {
    spatialCellSize: 0.13,
    cacheImmutableTraceGeometry: true,
  })
  const left = ordinary as unknown as InspectedEngine
  const right = cached as unknown as InspectedEngine
  let staticQueries = 0
  for (const index of right.obstacleIndexesByLayer.values()) {
    const query = index.query.bind(index)
    index.query = (bounds): Entity[] => {
      staticQueries++
      return query(bounds)
    }
  }
  expect(cached.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  const initialStaticQueries = staticQueries
  expect(initialStaticQueries).toBeGreaterThan(0)
  expect(cached.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(staticQueries).toBe(initialStaticQueries)
  expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)

  const states = [
    traces,
    [...traces].reverse(),
    [
      via("earlier_owner", "foreign", 0.08, 0.05, "top", "inner1", 0.8),
      ...traces,
    ],
    [
      wire(
        "same_id",
        "new_net",
        [
          [-2, -0.2],
          [2, 0.2],
        ],
        0.3,
      ),
      ...traces.slice(1),
    ],
    traces,
  ]
  let previousIndexes: Map<string, Index> | undefined
  let repeatedKeys: readonly string[] | undefined
  const queryBounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  for (const state of states) {
    const a = left.collectDynamicGeometry(state)
    const b = right.collectDynamicGeometry(state)
    const ordinaryIndexes = left.buildDynamicIndexes(a.segments, a.vias)
    const cachedIndexes = right.buildDynamicIndexes(b.segments, b.vias)
    expect([...cachedIndexes.keys()]).toEqual([...ordinaryIndexes.keys()])
    const stripPrivateKey = (entity: Entity): Record<string, unknown> => {
      const { geometryKey, ...publicGeometry } = entity
      return publicGeometry
    }
    for (const [layer, index] of cachedIndexes) {
      const expected = ordinaryIndexes.get(layer)!
      expect(index).not.toBe(previousIndexes?.get(layer))
      expect(
        [...index.cells].map(([key, items]) => [
          key,
          items.map(stripPrivateKey),
        ]),
      ).toEqual(
        [...expected.cells].map(([key, items]) => [
          key,
          items.map(stripPrivateKey),
        ]),
      )
      expect(index.query(queryBounds).map(stripPrivateKey)).toEqual(
        expected.query(queryBounds).map(stripPrivateKey),
      )
    }
    if (state === traces) {
      const keys = right.immutableDynamicCellKeys.get(
        b.segments[0]!.geometryKey!,
      )!
      expect(keys.length).toBeGreaterThan(1)
      if (repeatedKeys) expect(keys).toBe(repeatedKeys)
      repeatedKeys = keys
    }
    expect(cached.evaluate(state)).toEqual(ordinary.evaluate(state))
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    previousIndexes = cachedIndexes
  }
})
