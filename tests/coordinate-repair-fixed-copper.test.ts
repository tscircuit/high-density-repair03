import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, GlobalDrcCoordinateRepairSolver } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("coordinate repair clears a via without changing fixed copper or routing terminals", (): void => {
  const fixed: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "fixed",
    route: [{ route_type: "wire", x: -1, y: 1.5, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 1.5, width: 0.1, layer: "top" }],
  }]
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.16, minViaEdgeToPadEdgeClearance: 0.25,
    traces: fixed,
    connections: ["route", "fixed"].map((name) => ({ name, pointsToConnect: [] })),
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.6, height: 0.6,
      layers: ["top"], connectedTo: ["pcb_smtpad_other"] }],
  }
  const routes: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "route", connection_name: "route",
    route: [
      { route_type: "wire", x: -1, y: 0.55, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0.55, width: 0.1, layer: "top" },
      { route_type: "via", x: 0, y: 0.55, via_diameter: 0.3, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 0, y: 0.55, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0.55, width: 0.1, layer: "bottom" },
    ],
  }]
  const original = structuredClone({ srj, routes })
  const engine = new AutoroutingDrcEngine(srj, { traceToPadClearance: 0.16 })
  expect(engine.evaluate([...fixed, ...routes]).errors.length).toBeGreaterThan(0)
  const solver = new GlobalDrcCoordinateRepairSolver({ srj, routedTraces: routes })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.errors).toHaveLength(0)
  expect(engine.evaluate([...fixed, ...solver.getOutput()]).errors).toHaveLength(0)
  expect({ srj, routes }).toEqual(original)
  const output = solver.getOutput()[0]!.route
  expect(output[0]).toEqual(routes[0]!.route[0])
  expect(output.at(-1)).toEqual(routes[0]!.route.at(-1))
  expect(output.map((point) => point.route_type)).toEqual(routes[0]!.route.map((point) => point.route_type))
})
