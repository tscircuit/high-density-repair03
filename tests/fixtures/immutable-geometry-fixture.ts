import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
export const wire = (
  id: string,
  net: string,
  points: Array<[number, number]>,
  width = 0.15,
  layer = "top",
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: net,
  route: points.map(([x, y], i) => ({
    route_type: "wire",
    x,
    y,
    width,
    layer,
    ...(i === 0 ? { start_pcb_port_id: `${id}_port` } : {}),
  })),
})
export const via = (
  id: string,
  net: string,
  x: number,
  y: number,
  from = "top",
  to = "inner1",
  diameter = 0.3,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: net,
  route: [
    {
      route_type: "via",
      x,
      y,
      from_layer: from,
      to_layer: to,
      via_diameter: diameter,
    },
  ],
})
export const createImmutableGeometryFixture = (): {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
} => ({
  srj: {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.15,
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top", "inner1"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "pad_net", "pcb_port_pad"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 3, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "duplicate_is_skipped"],
      },
      {
        type: "rect",
        layers: ["top", "inner1", "inner2", "bottom"],
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_plated_hole_second", "pad_net"],
      },
    ],
  },
  traces: [
    wire("same_id", "a", [
      [-2, 0],
      [0, 0],
      [2, 0],
    ]),
    wire("cross", "b", [
      [0, -2],
      [0, 2],
    ]),
    wire("same_id", "c", [
      [-2, 0.18],
      [2, 0.18],
    ]),
    via("first_via", "v", 0.08, 0.05),
    via("later_via", "w", 2, 0),
  ],
})
