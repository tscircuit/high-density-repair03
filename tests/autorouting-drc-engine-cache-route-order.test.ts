import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("cached evaluation preserves ordered trace identities", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "horizontal",
      connection_name: "a",
      route: [
        { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "vertical",
      connection_name: "b",
      route: [
        { route_type: "wire", x: 0, y: -1, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.1 },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const original = engine.evaluate(traces)
  expect(engine.evaluate(traces)).toEqual(original)
  expect(engine.lastRunStats.exactCheckCount).toBe(0)

  traces.reverse()
  const reordered = engine.evaluate(traces)
  expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
  expect(reordered).toEqual(new AutoroutingDrcEngine(srj).evaluate(traces))
  expect(reordered.errors[0]!.pcb_trace_id).toBe("vertical")
  expect(reordered.errors[0]!.pcb_trace_error_id).not.toBe(
    original.errors[0]!.pcb_trace_error_id,
  )
})
