import { expect, test } from "bun:test"
import { GlobalDrcCoordinateRepairSolver } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("coordinate repair adds local bends around a fixed via while retaining terminals", (): void => {
  const fixed: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "fixed",
    route: [{ route_type: "via", x: 0, y: 0.1, via_diameter: 0.3,
      from_layer: "top", to_layer: "bottom" }],
  }]
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    obstacles: [], traces: fixed,
    connections: ["signal", "fixed"].map((name) => ({ name, pointsToConnect: [] })),
  }
  const traces: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "signal", connection_name: "signal",
    route: [{ route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" }],
  }]
  const original = structuredClone({ srj, traces })
  const solver = new GlobalDrcCoordinateRepairSolver({ srj, routedTraces: traces })
  expect(solver.errors.length).toBeGreaterThan(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.errors).toHaveLength(0)
  const route = solver.getOutput()[0]!.route
  expect(route.length).toBeGreaterThan(2)
  expect(route[0]).toEqual(traces[0]!.route[0])
  expect(route.at(-1)).toEqual(traces[0]!.route.at(-1))
  expect(route.every((point) => point.route_type === "wire")).toBe(true)
  expect({ srj, traces }).toEqual(original)
})
