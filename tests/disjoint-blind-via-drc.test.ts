import { beforeAll, expect, test } from "bun:test"
import { AutoroutingDrcEngine, type AutoroutingDrcResult } from "../lib"
import { createDisjointBlindVias } from "./fixtures/disjointBlindVias"

let result: AutoroutingDrcResult

beforeAll((): void => {
  const { srj, traces } = createDisjointBlindVias()
  const original = structuredClone(traces)
  const engine = new AutoroutingDrcEngine(srj)
  result = engine.evaluate(traces)
  expect(engine.lastRunStats.viaCount).toBe(2)
  expect(engine.lastRunStats.segmentCount).toBe(0)
  expect(traces).toEqual(original)
  // The same XY positions really do collide when both drills cross the board.
  const through = new AutoroutingDrcEngine({
    ...srj,
    allowBlindAndBuriedVias: false,
  }).evaluate(traces)
  expect(through.errors).toHaveLength(1)
  expect(through.errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    pcb_via_pair_net_relation: "different_net",
  })
  expect(through.errors[0]!.actual_clearance).toBeCloseTo(-0.1, 9)
})

test("disjoint blind vias do not produce a via-pair DRC", (): void => {
  expect(result.errors).toEqual([])
})
