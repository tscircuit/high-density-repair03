import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("via clearance uses rotated rectangular pad copper", () => {
  for (const angle of [0, 45, 90, 270]) {
    const radians = (angle * Math.PI) / 180
    const x = 1.14 * Math.cos(radians) - 0.64 * Math.sin(radians)
    const y = 1.14 * Math.sin(radians) + 0.64 * Math.cos(radians)
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 2,
          height: 1,
          ccwRotationDegrees: angle,
          layers: ["top", "bottom"],
          connectedTo: ["pcb_plated_hole_pad"],
        },
      ],
    }
    const traces: SimplifiedPcbTraces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "via-trace",
        connection_name: "foreign-net",
        route: [
          { route_type: "wire", x, y, width: 0.1, layer: "top" },
          { route_type: "via", x, y, from_layer: "top", to_layer: "bottom" },
          { route_type: "wire", x, y, width: 0.1, layer: "bottom" },
        ],
      },
    ]
    const result = new AutoroutingDrcEngine(srj).evaluate(traces)
    const viaErrors = result.errors.filter((error) => error.pcb_via_ids)
    expect(viaErrors).toHaveLength(1)
    expect(viaErrors[0]?.actual_clearance).toBeCloseTo(
      Math.hypot(0.14, 0.14) - 0.15,
      6,
    )
  }
})
