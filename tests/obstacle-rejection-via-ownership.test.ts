import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

test("selected obstacle checks preserve global via ownership, numbering and contact order", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top", "inner1", "inner2", "bottom"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const engine = new AutoroutingDrcEngine(srj)
  const traces: SimplifiedPcbTrace[] = []
  for (let index = 0; index < 4; index++) {
    traces.push({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: `net_${index}`,
      route: [
        { route_type: "wire", x: -1, y: index / 10, layer: "top", width: 0.1 },
        { route_type: "wire", x: 1, y: index / 10, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3 + index / 10,
        },
        {
          route_type: "via",
          x: index / 10,
          y: 0.2,
          from_layer: "inner1",
          to_layer: "inner2",
          via_diameter: 0.4,
        },
      ],
    })
  }
  for (const allowBlindAndBuriedVias of [false, true]) {
    srj.allowBlindAndBuriedVias = allowBlindAndBuriedVias
    for (let rotation = 0; rotation < traces.length; rotation++) {
      const allContacts = engine.getObstacleContactErrors(traces)
      expect(allContacts.length).toBeGreaterThan(0)
      for (let mask = 0; mask < 16; mask++) {
        const ids = new Set(
          traces
            .filter((_, index) => mask & (1 << index))
            .map((trace) => trace.pcb_trace_id),
        )
        const expected = allContacts.filter((error) =>
          ids.has(String(error.pcb_trace_id)),
        )
        expect(engine.getObstacleContactErrors(traces, ids)).toEqual(expected)
      }
      traces.push(traces.shift()!)
    }
  }
})
