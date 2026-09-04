import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("cached DRC observes live connectivity and per-pad net changes", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "source_a",
      route: [
        { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      connection_name: "source_b",
      route: [
        { route_type: "wire", x: 0, y: -2, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 2, layer: "top", width: 0.1 },
      ],
    },
  ]
  const connMap = new ConnectivityMap({
    net_a: ["source_a"],
    net_b: ["source_b"],
  })
  const engine = new AutoroutingDrcEngine(srj, { connMap })
  expect(engine.evaluate(traces).errors).toHaveLength(1)
  engine.evaluate(traces)
  expect(engine.lastRunStats.exactCheckCount).toBe(0)
  // Initial source-to-net lookups stay the same; only resolution of the
  // already-resolved net ids changes. These must not reuse the crossing error.
  connMap.addConnections([["net_a", "net_b"]])
  expect(connMap.getNetConnectedToId("source_a")).toBe("net_a")
  expect(connMap.getNetConnectedToId("source_b")).toBe("net_b")
  expect(engine.evaluate(traces).errors).toEqual([])

  srj.obstacles = [-1, 1].map((x, index) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [
      `pcb_smtpad_${index}`,
      index === 0 ? "source_a" : "source_b",
    ],
  }))
  const padEngine = new AutoroutingDrcEngine(srj)
  const singleTrace = traces.slice(0, 1)
  const before = padEngine.evaluate(singleTrace)
  expect(before.errors).toHaveLength(1)
  padEngine.evaluate(singleTrace)
  expect(padEngine.lastRunStats.exactCheckCount).toBe(0)
  srj.obstacles[0]!.connectedTo[1] = "source_b"
  srj.obstacles[1]!.connectedTo[1] = "source_a"
  const after = padEngine.evaluate(singleTrace)
  expect(padEngine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
  expect(after).toEqual(new AutoroutingDrcEngine(srj).evaluate(singleTrace))
  expect(after.errors).toHaveLength(1)
  expect(after).not.toEqual(before)

  const padMap = new ConnectivityMap({})
  const livePadEngine = new AutoroutingDrcEngine(srj, { connMap: padMap })
  expect(livePadEngine.evaluate(singleTrace).errors).toHaveLength(1)
  padMap.addConnections([["source_a", "source_b"]])
  expect(livePadEngine.evaluate(singleTrace).errors).toEqual([])
})
