import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  createImmutableGeometryFixture,
  via,
} from "./fixtures/immutable-geometry-fixture"
test("a thrown via layer validation does not commit successful cached geometry or poison later evaluations", (): void => {
  const { srj, traces } = createImmutableGeometryFixture()
  const ordinary = new AutoroutingDrcEngine(srj)
  const cached = new AutoroutingDrcEngine(srj, {
    cacheImmutableTraceGeometry: true,
  })
  const invalid = [...traces, via("invalid", "x", 1, 1, "unknown", "bottom")]
  for (let repeat = 0; repeat < 2; repeat++) {
    expect(() => ordinary.evaluate(invalid)).toThrow(
      "Via span unknown -> bottom is outside the board",
    )
    expect(() => cached.evaluate(invalid)).toThrow(
      "Via span unknown -> bottom is outside the board",
    )
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
    expect(cached.evaluate(traces)).toEqual(ordinary.evaluate(traces))
    expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
  }
})
