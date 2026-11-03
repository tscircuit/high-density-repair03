import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("shared existing vias are not SMT pads and retain foreign-net copper clearance", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.2,
    allowViaInPad: false,
    connections: [
      { name: "GND", pointsToConnect: [] },
      { name: "VCC", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "inner1", "inner2", "bottom"],
        connectedTo: [
          "pcb_via_existing",
          "pcb_smtpad_GND",
          "pcb_port_GND",
          "GND",
        ],
        circuitJsonMetadata: { pcb_via_id: "pcb_via_existing" },
      },
    ],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "ground_escape",
      connection_name: "GND",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.6,
        },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  expect(engine.evaluate(traces).errors).toHaveLength(0)
  const foreign = structuredClone(traces)
  foreign[0]!.connection_name = "VCC"
  const errors = engine.evaluate(foreign).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_pad_pad_clearance_error")
  const realPad = structuredClone(srj)
  delete realPad.obstacles[0]!.circuitJsonMetadata
  const ownPad = new AutoroutingDrcEngine(realPad).evaluate(traces).errors
  expect(ownPad).toHaveLength(1)
  expect(ownPad[0]!.type).toBe("pcb_placement_error")
})
