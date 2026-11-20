import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../lib"

export const createDisjointBlindVias = (): {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
} => ({
  srj: {
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [],
    connections: ["upper", "lower"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
  },
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "upper_trace",
      connection_name: "upper",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          via_diameter: 0.3,
          from_layer: "top",
          to_layer: "inner1",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "lower_trace",
      connection_name: "lower",
      route: [
        {
          route_type: "via",
          x: 0.2,
          y: 0,
          via_diameter: 0.3,
          from_layer: "inner2",
          to_layer: "bottom",
        },
      ],
    },
  ],
})
