import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("checks via-to-pad clearance on intermediate layers only within the span", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
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
  ]
  const input = structuredClone(traces)
  const errors = new AutoroutingDrcEngine(srj).evaluate(traces).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]?.type).toBe("pcb_pad_pad_clearance_error")
  expect(traces).toEqual(input)

  const via = traces[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.from_layer = "inner2"
  via.to_layer = "top"
  expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toEqual(errors)
  srj.obstacles[0]!.layers = ["bottom"]
  expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toEqual([])
})
