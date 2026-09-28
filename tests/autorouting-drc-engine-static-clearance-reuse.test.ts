import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  createImmutableGeometryFixture,
  wire,
} from "./fixtures/immutable-geometry-fixture"

test("immutable clear segments skip repeated static checks while changed and colliding geometry remains checked", (): void => {
  const { srj } = createImmutableGeometryFixture()
  const options = { spatialCellSize: 5, includeTraceViaOwnerMetadata: true }
  const control = new AutoroutingDrcEngine(srj, options)
  const cached = new AutoroutingDrcEngine(srj, {
    ...options,
    cacheImmutableTraceGeometry: true,
  })
  const inspected = cached as any
  const originalCheck = inspected.checkTraceObstacle.bind(inspected)
  let checks = 0
  inspected.checkTraceObstacle = (...args: any[]): unknown => {
    checks++
    return originalCheck(...args)
  }
  const clear = wire("same_id", "foreign", [
    [-2, 0.6],
    [2, 0.6],
  ])
  const crossing = wire("crossing", "another", [
    [0, -2],
    [0, 2],
  ])
  const changed = wire("same_id", "foreign", [
    [-2, 0],
    [2, 0],
  ])
  const states = [
    [clear],
    [clear],
    [clear, crossing],
    [crossing, clear],
    [changed],
    [changed],
    [clear],
  ]
  const deltas: number[] = []
  for (const traces of states) {
    const before = checks
    expect(cached.evaluate(traces)).toEqual(control.evaluate(traces))
    expect(cached.lastRunStats).toEqual(control.lastRunStats)
    deltas.push(checks - before)
    expect(cached.evaluateLegacy(traces)).toEqual(
      control.evaluateLegacy(traces),
    )
    expect(cached.lastRunStats).toEqual(control.lastRunStats)
  }
  expect(deltas[0]).toBeGreaterThan(0)
  expect(deltas[1]).toBe(0)
  expect(deltas[2]).toBeGreaterThan(0)
  expect(deltas[3]).toBe(deltas[2])
  expect(deltas[4]).toBeGreaterThan(0)
  expect(deltas[5]).toBe(deltas[4])
  expect(deltas[6]).toBe(0)
  expect(cached.evaluate([changed]).errors.length).toBeGreaterThan(0)
  expect(cached.evaluate([clear]).errors).toHaveLength(0)
})
