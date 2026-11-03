import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"

test("a reused plated hole is not a new drill", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    allowViaInPad: false,
    connections: [{ name: "GND", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.8,
        height: 0.8,
        layers: ["top", "bottom"],
        connectedTo: ["pcb_plated_hole_0", "GND"],
      },
    ],
  }
  const points: HighDensityRoute["route"] = [
    { x: -2, y: 0, z: 0 },
    { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
    { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
  ]
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "ground",
    connection_name: "GND",
    route: convertHdRouteToSimplifiedRoute(points, 2),
  }
  const vias = trace.route.filter((point) => point.route_type === "via")
  expect(vias).toEqual([])
  expect(trace.route).toHaveLength(4)
  const engine = new AutoroutingDrcEngine(srj)
  expect(engine.evaluate([trace]).errors).toEqual([])

  const newDrill = points.map((point) => ({
    ...point,
    toNextSegmentType: undefined,
  }))
  trace.route = convertHdRouteToSimplifiedRoute(newDrill, 2)
  const newVias = trace.route.filter((point) => point.route_type === "via")
  expect(newVias).toHaveLength(1)
  const errors = engine.evaluate([trace]).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_placement_error")
})
