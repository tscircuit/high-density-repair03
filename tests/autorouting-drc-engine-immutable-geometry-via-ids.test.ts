import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  createImmutableGeometryFixture,
  via,
} from "./fixtures/immutable-geometry-fixture"
test("immutable spatial reuse retain fresh global via dedup owners and shifted error identifiers", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const ordinary = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  })
  const cached = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
    cacheImmutableTraceGeometry: true,
  })
  const duplicate = via(
    "other_owner",
    "new_net",
    0.08,
    0.05,
    "top",
    "inner1",
    0.6,
  )
  const prefix = via("unrelated_prefix", "prefix_net", -4, -4)
  const states = [
    traces,
    [prefix, ...traces],
    [duplicate, ...traces],
    traces,
    [...traces, duplicate],
    traces,
  ]
  for (const state of states) {
    const expected = ordinary.evaluate(state),
      actual = cached.evaluate(state)
    expect(actual).toEqual(expected)
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    const padErrors = actual.errors.filter(
      (e) => e.type === "pcb_pad_pad_clearance_error",
    )
    expect(padErrors.length).toBeGreaterThan(0)
    if (state[0] === duplicate)
      expect(padErrors[0]?.pcb_trace_id).toBe("other_owner")
    if (state[0] === prefix)
      expect(padErrors[0]?.pcb_via_ids).toEqual(["via_1"])
  }
})
