import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, type SimplifiedPcbTraces } from "../lib"
import { createDisjointBlindVias } from "./fixtures/disjointBlindVias"

type Via = Extract<
  SimplifiedPcbTraces[number]["route"][number],
  { route_type: "via" }
>

test("via-pair checks honor actual layers through both cached evaluator policies", (): void => {
  const { srj, traces } = createDisjointBlindVias()
  const upper = traces[0]!.route[0]! as Via
  const lower = traces[1]!.route[0]! as Via
  for (const queryResultCacheBudget of [0, 8_000_000]) {
    for (const sameNet of [false, true]) {
      traces[1]!.connection_name = sameNet ? "upper" : "lower"
      const engine = new AutoroutingDrcEngine(srj, { queryResultCacheBudget })
      for (const evaluate of [
        engine.evaluate.bind(engine),
        engine.evaluateLegacy.bind(engine),
      ]) {
        for (const reverse of [false, true]) {
          upper.from_layer = reverse ? "inner1" : "top"
          upper.to_layer = reverse ? "top" : "inner1"
          lower.from_layer = reverse ? "bottom" : "inner2"
          lower.to_layer = reverse ? "inner2" : "bottom"
          delete upper.layers
          delete lower.layers
          expect(evaluate(traces).errors).toEqual([])
          expect(evaluate(traces).errors).toEqual([])
          // Sharing just one endpoint layer is enough for a real collision.
          upper.from_layer = "top"
          upper.to_layer = "inner2"
          const shared = evaluate(traces).errors
          expect(shared).toHaveLength(1)
          expect(shared[0]).toMatchObject({
            type: "pcb_via_clearance_error",
            pcb_via_pair_net_relation: sameNet ? "same_net" : "different_net",
          })
          expect(evaluate(traces).errors).toEqual(shared)
          // Explicit copper arrays, not just their min/max endpoints, govern DRC.
          upper.layers = ["top", "inner2"]
          lower.layers = ["inner1", "bottom"]
          expect(evaluate(traces).errors).toEqual([])
          lower.layers.push("inner2")
          expect(evaluate(traces).errors).toHaveLength(1)
        }
      }
    }
  }
  // Default manufacturing policy still expands both vias to through drills.
  for (const allowBlindAndBuriedVias of [false, undefined]) {
    const engine = new AutoroutingDrcEngine({ ...srj, allowBlindAndBuriedVias })
    upper.layers = ["top", "inner1"]
    lower.layers = ["inner2", "bottom"]
    expect(engine.evaluate(traces).errors).toHaveLength(1)
    expect(engine.evaluateLegacy(traces).errors).toHaveLength(1)
  }
})
