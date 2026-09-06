import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("uses Core drill-edge spacing for via pairs", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: ["net_a", "net_b"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.05,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = ["net_a", "net_b"].map(
    (connectionName, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: connectionName,
      route: [
        {
          route_type: "wire",
          x: index * 0.35,
          y: -1,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: index * 0.35,
          y: 0,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "via",
          x: index * 0.35,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        {
          route_type: "wire",
          x: index * 0.35,
          y: 1,
          width: 0.1,
          layer: "bottom",
        },
      ],
    }),
  )

  const errors = new AutoroutingDrcEngine(srj)
    .evaluate(traces)
    .errors.filter((error) => error.type === "pcb_via_clearance_error")

  expect(errors).toHaveLength(0)

  const tooCloseTraces = structuredClone(traces)
  for (const routePoint of tooCloseTraces[1]!.route) {
    if (routePoint.route_type !== "jumper") routePoint.x = 0.25
  }
  const tooCloseErrors = new AutoroutingDrcEngine(srj)
    .evaluate(tooCloseTraces)
    .errors.filter((error) => error.type === "pcb_via_clearance_error")

  expect(tooCloseErrors).toHaveLength(1)
  expect(tooCloseErrors[0]!.minimum_clearance).toBe(0.1)
  expect(Number(tooCloseErrors[0]!.actual_clearance)).toBeCloseTo(0.05)
})
