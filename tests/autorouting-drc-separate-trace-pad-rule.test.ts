import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("separate pad clearance preserves trace spacing rules and exposes individual contacts", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: ["a", "b"].map((name) => ({ name, pointsToConnect: [] })),
    obstacles: [{
      type: "rect", center: { x: 0, y: 0.27 }, width: 0.2, height: 0.2,
      layers: ["top"], connectedTo: ["pcb_smtpad_test", "pad_net"], obstacleId: "pad",
    }],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace", pcb_trace_id: "a", connection_name: "a",
      route: [-1, 0, 1].map((x) => ({
        route_type: "wire", x, y: 0, width: 0.1, layer: "top",
      })),
    },
    {
      type: "pcb_trace", pcb_trace_id: "b", connection_name: "b",
      route: [-1, 1].map((x) => ({
        route_type: "wire", x, y: -0.23, width: 0.1, layer: "top",
      })),
    },
  ]
  expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toHaveLength(0)
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1, traceToPadClearance: 0.16,
  })
  const errors = engine.evaluate(traces).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]!.minimum_clearance).toBe(0.16)
  expect(errors[0]!.actual_clearance).toBeCloseTo(0.12)
  expect(engine.evaluateContacts(traces).errors).toHaveLength(2)
})
