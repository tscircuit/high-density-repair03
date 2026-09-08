import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("refreshes obstacle membership after connectivity changes between evaluations", (): void => {
  const connMap = new ConnectivityMap({ signal_net: ["signal"], pad_net: ["pad"] })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "signal", pointsToConnect: [] },
      { name: "pad", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_foreign", "pad"],
      },
    ],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_signal",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj, { connMap })
  const first = engine.evaluate(traces)
  expect(first.errors).toHaveLength(1)
  expect(engine.evaluate(traces)).toEqual(first)
  connMap.addConnections([["signal", "pad"]])
  const connected = engine.evaluate(traces)
  expect(connected.errors).toHaveLength(0)
  expect(connected).toEqual(
    new AutoroutingDrcEngine(srj, { connMap }).evaluate(traces),
  )
  expect(engine.evaluateLegacy(traces).errors).toHaveLength(0)
})
