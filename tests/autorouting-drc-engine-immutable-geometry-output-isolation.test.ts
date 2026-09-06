import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { createImmutableGeometryFixture } from "./fixtures/immutable-geometry-fixture"
test("first and repeated evaluations return detached error points and port arrays without corrupting templates", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const ordinary = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  })
  const expected = ordinary.evaluate(traces),
    original = structuredClone(traces)
  const cached = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
    cacheImmutableTraceGeometry: true,
  })
  for (let call = 0; call < 3; call++) {
    const actual = cached.evaluate(traces)
    expect(actual).toEqual(expected)
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    expect(actual.errorsWithCenters[0]).toBe(actual.errors[0])
    for (const error of actual.errors) {
      if (error.center) error.center.x = 10000
      for (const key of [
        "first_contact_center",
        "worst_contact_center",
        "pcb_center",
      ]) {
        const value = error[key]
        if (value && typeof value === "object" && "x" in value) value.x = 10000
      }
      for (const value of Object.values(error))
        if (Array.isArray(value)) value.push("caller_mutation")
      error.message = "caller_mutation"
    }
    expect(traces).toEqual(original)
  }
})
