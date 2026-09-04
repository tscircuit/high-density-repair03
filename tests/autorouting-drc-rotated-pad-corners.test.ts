import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("DRC preserves rectangular pad corners and rotation", () => {
  for (const height of [1, 2]) {
    for (const angle of [0, 45, 90, 270]) {
      const radians = (angle * Math.PI) / 180
      const rotate = (x: number, y: number): { x: number; y: number } => ({
        x: 3 + x * Math.cos(radians) - y * Math.sin(radians),
        y: 2 + x * Math.sin(radians) + y * Math.cos(radians),
      })
      const srj: SimpleRouteJson = {
        layerCount: 2,
        minTraceWidth: 0.1,
        bounds: { minX: -5, minY: -5, maxX: 8, maxY: 8 },
        connections: [],
        obstacles: [
          {
            type: "rect",
            center: { x: 3, y: 2 },
            width: 2,
            height,
            ccwRotationDegrees: angle,
            layers: ["top", "bottom"],
            connectedTo: ["pcb_plated_hole_pad"],
          },
        ],
      }
      const traces: SimplifiedPcbTraces = [
        {
          type: "pcb_trace",
          pcb_trace_id: "corner-trace",
          connection_name: "foreign-net",
          route: [
            {
              route_type: "wire",
              ...rotate(1.25, height / 2 - 0.1),
              width: 0.1,
              layer: "top",
            },
            {
              route_type: "wire",
              ...rotate(0.9, height / 2 + 0.25),
              width: 0.1,
              layer: "top",
            },
          ],
        },
      ]
      const result = new AutoroutingDrcEngine(srj).evaluate(traces)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.actual_clearance).toBeCloseTo(
        0.15 / Math.SQRT2 - 0.05,
        6,
      )
      const pad = convertToCircuitJson(srj, traces).find(
        (element) => element.type === "pcb_plated_hole",
      )
      expect(pad).toMatchObject({
        shape: "rotated_pill_hole_with_rect_pad",
        rect_pad_width: 2,
        rect_pad_height: height,
        rect_ccw_rotation: angle,
      })
      srj.obstacles[0]!.connectedTo.push("foreign-net")
      expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toEqual([])
    }
  }
})
