import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("DRC checks forward and reversed via endpoint spans identically", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaDiameter: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "power",
      connection_name: "power",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.12, layer: "inner1" },
        { route_type: "wire", x: 1, y: 0, width: 0.12, layer: "inner1" },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  expect(engine.evaluate(traces).errors.length).toBeGreaterThan(0)
  const declared = structuredClone(traces)
  const via = declared[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.from_layer = "inner2"
  via.to_layer = "top"
  expect(engine.evaluate(declared).errors).toEqual(
    engine.evaluate(traces).errors,
  )
  via.from_layer = "bottom"
  expect(engine.evaluate(declared).errors.length).toBeGreaterThan(0)
  for (const point of declared[1]!.route) {
    if (point.route_type === "wire") point.layer = "bottom"
  }
  expect(engine.evaluate(declared).errors.length).toBeGreaterThan(0)
  via.from_layer = "inner2"
  expect(engine.evaluate(declared).errors).toEqual([])
  const json = convertToCircuitJson(srj, declared)
  const exportedVia = json.find((element) => element.type === "pcb_via")
  expect(exportedVia?.layers).toEqual(["top", "inner1", "inner2"])
  expect(engine.evaluate(traces).errors.length).toBeGreaterThan(0)
})
