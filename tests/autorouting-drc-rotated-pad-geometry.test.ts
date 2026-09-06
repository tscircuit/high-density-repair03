import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

type Point = { x: number; y: number }

test("rotated pad DRC uses copper geometry for traces and vias", (): void => {
  for (const degrees of [0, 45, 90, 180, 225, 270]) {
    const radians: number = (degrees * Math.PI) / 180
    const rotate = (x: number, y: number): Point => {
      const cosine: number = Math.cos(radians)
      const sine: number = Math.sin(radians)
      return {
        x: 2 + x * cosine - y * sine,
        y: -3 + x * sine + y * cosine,
      }
    }
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -2, maxX: 6, minY: -7, maxY: 1 },
      connections: [
        { name: "signal", pointsToConnect: [] },
        { name: "pad_net", pointsToConnect: [] },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 2, y: -3 },
          width: 3,
          height: 0.3,
          ccwRotationDegrees: degrees,
          connectedTo: ["pcb_smtpad_rotated", "pad_net"],
        },
      ],
    }
    const engine = new AutoroutingDrcEngine(srj, { spatialCellSize: 0.2 })
    for (const [localY, expectedCount] of [
      [0.19, 1],
      [0.4, 0],
    ] as const) {
      const traces: SimplifiedPcbTraces = [
        {
          type: "pcb_trace",
          pcb_trace_id: "signal_trace",
          connection_name: "signal",
          route: [
            {
              route_type: "wire",
              ...rotate(0.8, localY),
              layer: "top",
              width: 0.1,
            },
            {
              route_type: "wire",
              ...rotate(1, localY),
              layer: "top",
              width: 0.1,
            },
          ],
        },
      ]
      const result = engine.evaluate(traces)
      expect(result.errors).toHaveLength(expectedCount)
      if (expectedCount === 1) {
        expect(result.errors[0]?.actual_clearance).toBeCloseTo(-0.01, 8)
        expect(result.errors[0]?.pcb_trace_error_id).toBe(
          "overlap_signal_trace_pcb_smtpad_rotated",
        )
        const expectedCenter: Point = rotate(0.8, 0.17)
        expect(result.errors[0]?.center?.x).toBeCloseTo(expectedCenter.x, 8)
        expect(result.errors[0]?.center?.y).toBeCloseTo(expectedCenter.y, 8)
      }
    }
    for (const [localY, expectedCount] of [
      [0.35, 1],
      [0.8, 0],
    ] as const) {
      const traces: SimplifiedPcbTraces = [
        {
          type: "pcb_trace",
          pcb_trace_id: "signal_via",
          connection_name: "signal",
          route: [
            {
              route_type: "via",
              ...rotate(0.9, localY),
              from_layer: "top",
              to_layer: "bottom",
              via_diameter: 0.3,
            },
          ],
        },
      ]
      const result = engine.evaluate(traces)
      expect(result.errors).toHaveLength(expectedCount)
      if (expectedCount === 1) {
        expect(result.errors[0]?.actual_clearance).toBeCloseTo(0.05, 8)
        expect(result.errors[0]?.type).toBe("pcb_pad_pad_clearance_error")
      }
    }
  }
})
