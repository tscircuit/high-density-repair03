import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("detects a different-net wire crossing a through via on an inner layer", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "crossing_net", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
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
    {
      type: "pcb_trace",
      pcb_trace_id: "inner_crossing_trace",
      connection_name: "crossing_net",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -0.5,
          width: 0.1,
          layer: "inner2",
        },
        {
          route_type: "wire",
          x: 0,
          y: 0.5,
          width: 0.1,
          layer: "inner2",
        },
      ],
    },
  ]

  const result = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  }).evaluate(traces)

  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_trace_error",
    pcb_trace_id: "inner_crossing_trace",
    pcb_trace_ids: ["inner_crossing_trace", "through_via_trace"],
    pcb_via_id: "via_0",
    pcb_via_ids: ["via_0"],
  })
})
