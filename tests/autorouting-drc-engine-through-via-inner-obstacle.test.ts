import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("detects a through via colliding with a different-net inner-layer pad", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "pad_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["inner2"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_inner", "pad_net"],
      },
    ],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "through_via_trace",
      connection_name: "via_net",
      route: [
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "inner1" },
      ],
    },
  ]

  const result = new AutoroutingDrcEngine(srj).evaluate(traces)

  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "through_via_trace",
    pcb_pad_ids: ["via_0", "pcb_smtpad_inner"],
    pcb_via_ids: ["via_0"],
    minimum_clearance: 0.1,
  })
})
