import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimplifiedPcbTraces } from "../lib/types"
import {
  createImmutableGeometryFixture,
  via,
  wire,
} from "./fixtures/immutable-geometry-fixture"

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Entity = { geometryKey?: object; [key: string]: unknown }
type Segment = Entity & {
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  layer: string
}
type Index = {
  query: (bounds: Bounds) => Entity[]
  queryWithCellKeys: (keys: readonly string[]) => Entity[]
}
type InspectedEngine = {
  collectDynamicGeometry: (traces: SimplifiedPcbTraces) => {
    segments: Segment[]
    vias: Entity[]
  }
  buildDynamicIndexes: (
    segments: Segment[],
    vias: Entity[],
  ) => Map<string, Index>
  immutableDynamicCellKeys: WeakMap<object, readonly string[]>
  immutableDynamicQueryCellKeys: WeakMap<object, readonly string[]>
}

test("cached dynamic query cells remain unexpanded and preserve fresh Set order as neighboring routes change", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const ordinary = new AutoroutingDrcEngine(srj, { spatialCellSize: 0.13 })
  const cached = new AutoroutingDrcEngine(srj, {
    spatialCellSize: 0.13,
    cacheImmutableTraceGeometry: true,
  })
  const inspected = cached as unknown as InspectedEngine
  let priorQueryKeys: readonly string[] | undefined
  let sawDifferentInsertionCells = false
  const states = [
    traces,
    [...traces].reverse(),
    [via("new_owner", "new_net", 0.08, 0.05, "top", "inner1", 0.5), ...traces],
    [
      wire("cross", "foreign", [
        [-0.03, -3],
        [-0.03, 3],
      ]),
      ...traces,
    ],
    traces,
  ]
  for (const state of states) {
    expect(cached.evaluate(state)).toEqual(ordinary.evaluate(state))
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    const geometry = inspected.collectDynamicGeometry(state)
    const indexes = inspected.buildDynamicIndexes(
      geometry.segments,
      geometry.vias,
    )
    for (const segment of geometry.segments) {
      const queryKeys = inspected.immutableDynamicQueryCellKeys.get(
        segment.geometryKey!,
      )!
      const insertionKeys = inspected.immutableDynamicCellKeys.get(
        segment.geometryKey!,
      )!
      expect(queryKeys).toBeDefined()
      if (queryKeys.length !== insertionKeys.length)
        sawDifferentInsertionCells = true
      const radius = segment.width / 2
      const bounds = {
        minX: Math.min(segment.start.x, segment.end.x) - radius,
        minY: Math.min(segment.start.y, segment.end.y) - radius,
        maxX: Math.max(segment.start.x, segment.end.x) + radius,
        maxY: Math.max(segment.start.y, segment.end.y) + radius,
      }
      const index = indexes.get(segment.layer)!
      const expected = index.query(bounds)
      const actual = index.queryWithCellKeys(queryKeys)
      expect(actual).toEqual(expected)
      expect(actual).not.toBe(expected)
      actual.splice(0)
      expect(index.queryWithCellKeys(queryKeys)).toEqual(expected)
    }
    if (state === traces) {
      const queryKeys = inspected.immutableDynamicQueryCellKeys.get(
        geometry.segments[0]!.geometryKey!,
      )!
      if (priorQueryKeys) expect(queryKeys).toBe(priorQueryKeys)
      priorQueryKeys = queryKeys
    }
  }
  expect(sawDifferentInsertionCells).toBe(true)
})
