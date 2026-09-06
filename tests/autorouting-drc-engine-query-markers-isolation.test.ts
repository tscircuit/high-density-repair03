import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { createImmutableGeometryFixture } from "./fixtures/immutable-geometry-fixture"

const freeze = (value: any): void => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
const corrupt = (value: any, visited = new Set<object>()): void => {
  if (!value || typeof value !== "object" || visited.has(value)) return
  visited.add(value)
  for (const child of Object.values(value)) corrupt(child, visited)
  if (Array.isArray(value)) value.push("mutated")
  else {
    value.lastDynamicQueryOrder = 0
    if ("x" in value) value.x = 1e6
    if ("message" in value) value.message = "mutated"
  }
}

test("fresh evaluation markers cannot escape into frozen inputs or poison subsequent results through returned output", (): void => {
  const fixture = createImmutableGeometryFixture()
  freeze(fixture)
  const before = JSON.stringify(fixture)
  const options = { cacheImmutableTraceGeometry: true, spatialCellSize: 0.13 }
  const control = new AutoroutingDrcEngine(fixture.srj, options)
  const fast = new AutoroutingDrcEngine(fixture.srj, {
    ...options,
    useTransientDynamicQueryMarkers: true,
  })
  for (const traces of [
    fixture.traces,
    [...fixture.traces].reverse(),
    [],
    fixture.traces,
  ]) {
    for (const method of ["evaluate", "evaluateLegacy"] as const) {
      const expected = control[method](traces)
      const actual = fast[method](traces)
      expect(actual).toEqual(expected)
      expect(fast.lastRunStats).toEqual(control.lastRunStats)
      expect(JSON.stringify(actual)).not.toContain("lastDynamicQueryOrder")
      corrupt(actual)
    }
  }
  expect(JSON.stringify(fixture)).toBe(before)
})
