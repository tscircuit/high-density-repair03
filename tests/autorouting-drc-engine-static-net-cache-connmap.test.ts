import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("default mutable connectivity maps remain live and cannot opt in to immutable obstacle caching", (): void => {
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
        connectedTo: ["pcb_smtpad_mutable", "pad_alias"],
      },
    ],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_mutable",
      connection_name: "trace_alias",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const connMap = new ConnectivityMap({})
  const ordinary = new AutoroutingDrcEngine(srj, { connMap })
  const explicitDefault = new AutoroutingDrcEngine(srj, {
    connMap,
    cacheStaticObstacleNetMembership: false,
  })
  expect(ordinary.evaluate(traces).errors).toHaveLength(1)
  expect(explicitDefault.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  connMap.addConnections([["trace_alias", "pad_alias"]])
  expect(ordinary.evaluate(traces).errors).toHaveLength(0)
  expect(explicitDefault.evaluate(traces)).toEqual(ordinary.evaluate(traces))
  expect(explicitDefault.lastRunStats).toEqual(ordinary.lastRunStats)
  expect(
    (): AutoroutingDrcEngine =>
      new AutoroutingDrcEngine(srj, {
        connMap,
        cacheStaticObstacleNetMembership: true,
      }),
  ).toThrow("cacheStaticObstacleNetMembership cannot be combined with connMap")
})
