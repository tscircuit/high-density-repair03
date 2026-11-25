import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("checks the wire segment leaving a via", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 3, maxY: 1 },
    connections: [
      { name: "net_a", pointsToConnect: [] },
      { name: "net_b", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "net_b"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "net_a",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  const result = new AutoroutingDrcEngine(srj).evaluate(traces)

  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    pcb_trace_id: "trace_a",
    pcb_smtpad_id: "pcb_smtpad_foreign",
  })
})
