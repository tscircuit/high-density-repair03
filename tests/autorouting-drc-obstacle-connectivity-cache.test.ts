import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("obstacle connectivity is reused within each evaluation and refreshed between evaluations", (): void => {
  const connMap = new ConnectivityMap({})
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "signal", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_signal",
      connection_name: "signal",
      route: Array.from({ length: 21 }, (_, i) => ({
        route_type: "wire" as const,
        x: -0.5 + i * 0.05,
        y: 0,
        width: 0.1,
        layer: "top",
      })),
    },
  ]
  const engine = new AutoroutingDrcEngine(srj, { connMap })
  const getNet = connMap.getNetConnectedToId.bind(connMap)
  let foreignLookups = 0
  connMap.getNetConnectedToId = (id: string): string | undefined => {
    if (id === "pcb_smtpad_foreign") foreignLookups++
    return getNet(id)
  }
  const first = engine.evaluate(traces)
  expect(first.errors.length).toBeGreaterThan(0)
  expect(foreignLookups).toBe(1)
  expect(engine.evaluate(traces).errors).toEqual(first.errors)
  expect(foreignLookups).toBe(2)
  connMap.addConnections([["signal", "pcb_smtpad_foreign"]])
  expect(engine.evaluate(traces).errors).toHaveLength(0)
})
