import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("detects different-net via-to-pad clearance", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 2 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "foreign_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.4, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_same", "via_net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "foreign_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_with_via",
      connection_name: "via_net",
      route: [
        { route_type: "wire", x: -1, y: 1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 1,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  const result = new AutoroutingDrcEngine(srj).evaluate(traces)

  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "trace_with_via",
    pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
    pcb_via_ids: ["via_0"],
    minimum_clearance: 0.1,
  })
  expect(result.errors[0]?.actual_clearance).toBeCloseTo(0.05)
})

test("reports via-to-pad errors while legacy DRC errors remain", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 2 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "foreign_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.7, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_trace_blocker", "foreign_net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_via_blocker", "foreign_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_with_via",
      connection_name: "via_net",
      route: [
        { route_type: "wire", x: -1, y: 1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 1,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)

  expect(engine.evaluate(traces).errors.map((error) => error.type)).toEqual([
    "pcb_trace_error",
    "pcb_pad_pad_clearance_error",
  ])
})
