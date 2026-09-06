import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { createImmutableGeometryFixture } from "./fixtures/immutable-geometry-fixture"

test("query markers require the fresh immutable-geometry path and remain absent from omitted and explicit false modes", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  expect(
    () =>
      new AutoroutingDrcEngine(srj, { useTransientDynamicQueryMarkers: true }),
  ).toThrow(
    "useTransientDynamicQueryMarkers requires cacheImmutableTraceGeometry",
  )
  const ordinary = new AutoroutingDrcEngine(srj)
  for (const cacheImmutableTraceGeometry of [false, true]) {
    for (const markerOptions of [
      {},
      { useTransientDynamicQueryMarkers: false },
    ]) {
      const engine = new AutoroutingDrcEngine(srj, {
        cacheImmutableTraceGeometry,
        ...markerOptions,
      }) as any
      let markerCalls = 0
      const build = engine.buildDynamicIndexes.bind(engine)
      engine.buildDynamicIndexes = (...args: any[]): any => {
        const indexes = build(...args)
        for (const index of indexes.values())
          index.queryWithCellKeysUsingOrder = (): never => {
            markerCalls++
            throw new Error("unexpected marker path")
          }
        return indexes
      }
      expect(engine.evaluate(traces)).toEqual(ordinary.evaluate(traces))
      expect(engine.lastRunStats).toEqual(ordinary.lastRunStats)
      expect(markerCalls).toBe(0)
    }
  }
})
