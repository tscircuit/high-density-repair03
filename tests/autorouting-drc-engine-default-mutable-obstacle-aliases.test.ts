import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("the default engine still observes obstacle alias-array edits between evaluations", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_mutable"],
      },
    ],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_mutable",
      connection_name: "unknown_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const ordinary = new AutoroutingDrcEngine(srj)
  const explicitDefault = new AutoroutingDrcEngine(srj, {
    cacheStaticObstacleNetMembership: false,
  })
  expect(ordinary.evaluate(traces).errors).toHaveLength(1)
  srj.obstacles[0]!.connectedTo.push("unknown_net")
  expect(ordinary.evaluate(traces).errors).toHaveLength(0)
  expect(explicitDefault.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  srj.obstacles[0]!.connectedTo.pop()
  expect(ordinary.evaluate(traces).errors).toHaveLength(1)
  expect(explicitDefault.evaluate(traces)).toEqual(ordinary.evaluate(traces))
})
