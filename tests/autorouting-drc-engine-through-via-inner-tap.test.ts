import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("allows a same-net inner-layer wire to tap a through via", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [
      {
        name: "shared_mst0",
        rootConnectionName: "shared",
        pointsToConnect: [],
      },
      {
        name: "shared_mst1",
        rootConnectionName: "shared",
        pointsToConnect: [],
      },
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
      connection_name: "shared_mst0",
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
      pcb_trace_id: "inner_tap_trace",
      connection_name: "shared_mst1",
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

  const result = new AutoroutingDrcEngine(srj).evaluate(traces)

  expect(result.errors).toEqual([])
})
