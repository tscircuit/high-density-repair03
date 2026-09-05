import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("reference geometry includes intermediate via layers and uses the board stack for HD routes", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.12, minViaDiameter: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [], connections: [{ name: "power", pointsToConnect: [] }],
  }
  const simplified: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "power", connection_name: "power",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.12 },
      { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "inner2" },
      { route_type: "wire", x: 0, y: 0, layer: "inner2", width: 0.12 },
    ],
  }]
  const hd: HighDensityRoute[] = [{
    connectionName: "power", traceThickness: 0.12, viaDiameter: 0.2,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }], vias: [{ x: 0, y: 0 }],
  }]
  for (const allowBlindAndBuriedVias of [false, true]) {
    for (const routes of [simplified, hd]) {
      const json = convertToCircuitJson({ ...srj, allowBlindAndBuriedVias }, routes)
      const via = json.find((element) => element.type === "pcb_via")
      expect(via?.layers).toEqual(allowBlindAndBuriedVias ? ["top", "inner1", "inner2"] : ["top", "inner1", "inner2", "bottom"])
      const trace = json.find((element) => element.type === "pcb_trace")
      const last = trace?.route.at(-1)
      expect(last?.route_type === "wire" && last.layer).toBe("inner2")
    }
  }
})
