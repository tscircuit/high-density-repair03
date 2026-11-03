import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("own-pad drill checks retain circular gaps, layer spans and per-via hole sizes", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_A", "A"],
      },
    ],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.28,
    minViaHoleDiameter: 0.15,
    allowViaInPad: false,
    allowBlindAndBuriedVias: true,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      connection_name: "A",
      route: [
        {
          route_type: "via",
          x: 0.13,
          y: 0.13,
          via_diameter: 0.28,
          from_layer: "top",
          to_layer: "bottom",
        },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  expect(engine.evaluate(traces).errors).toHaveLength(0)
  const largeDrill = structuredClone(traces)
  const via = largeDrill[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.via_hole_diameter = 0.2
  expect(engine.evaluate(largeDrill).errors).toHaveLength(1)
  expect(engine.evaluate(traces).errors).toHaveLength(0)
  via.from_layer = "inner1"
  via.to_layer = "inner2"
  expect(engine.evaluate(largeDrill).errors).toHaveLength(0)
})
