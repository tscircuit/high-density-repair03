import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("checks and exports the physical geometry of rotated pads", (): void => {
  for (const layers of [["top"], ["top", "bottom"]]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 1,
          height: 0.1,
          ccwRotationDegrees: 90,
          layers,
          connectedTo: [
            layers.length === 1 ? "pcb_smtpad_pad" : "pcb_plated_hole_pad",
          ],
        },
      ],
    }
    const traces: SimplifiedPcbTraces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "signal",
        connection_name: "signal",
        route: [
          { route_type: "wire", x: -0.3, y: 0.4, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0.3, y: 0.4, width: 0.1, layer: "top" },
        ],
      },
    ]
    const engine = new AutoroutingDrcEngine(srj)
    expect(engine.evaluate(traces).errors).toHaveLength(1)
    traces[0]!.route = [
      {
        route_type: "via",
        x: 0,
        y: 0.4,
        from_layer: "top",
        to_layer: "bottom",
      },
    ]
    expect(engine.evaluate(traces).errors).toHaveLength(1)
    const pad = convertToCircuitJson(srj, traces).find(
      (element) =>
        element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )
    expect(pad).toMatchObject(
      layers.length === 1
        ? { shape: "rotated_rect", ccw_rotation: 90, width: 1, height: 0.1 }
        : {
            shape: "rotated_pill_hole_with_rect_pad",
            rect_ccw_rotation: 90,
            rect_pad_width: 1,
            rect_pad_height: 0.1,
          },
    )
  }
})
