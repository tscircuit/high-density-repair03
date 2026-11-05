import { expect, spyOn, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

type CacheState = {
  getPrimitiveId: (values: unknown[]) => number | undefined
  primitiveKeyUnits: number
  geometryCacheUnits: number
  queryResultUnits: number
}

test("bounded geometry reuse matches uncached DRC across mutations and key eviction", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [],
    obstacles: [],
  }
  const traces: SimplifiedPcbTrace[] = []
  for (let index = 0; index < 80; index++) {
    traces.push({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: `net_${index % 4}`,
      route: [
        {
          route_type: "wire",
          x: -2,
          y: index / 40,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: `port_${index}`,
        },
        { route_type: "wire", x: 2, y: index / 40, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: (index % 8) / 40,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
      ],
    })
  }
  const budget = 32_768
  const cached = new AutoroutingDrcEngine(srj, {
    queryResultCacheBudget: budget,
  })
  const uncached = new AutoroutingDrcEngine(srj, { queryResultCacheBudget: 0 })
  const state = cached as unknown as CacheState
  const keys = spyOn(state, "getPrimitiveId")
  try {
    for (let iteration = 0; iteration < 24; iteration++) {
      const trace = traces[iteration % traces.length]!
      const point = trace.route[0]!
      const via = trace.route[2]!
      if (point.route_type !== "wire" || via.route_type !== "via")
        throw new Error("Expected wire and via fixture points")
      point.y = iteration % 2 ? -0 : iteration / 20
      point.width = 0.1 + (iteration % 3) / 10
      point.start_pcb_port_id = `changed_${iteration}`
      via.via_hole_diameter = 0.05 + iteration / 100
      via.to_layer = iteration % 2 ? "inner2" : "bottom"
      srj.allowBlindAndBuriedVias = iteration % 3 === 0
      if (iteration % 4 === 0) traces.reverse()
      const expected = uncached.evaluate(traces)
      expect(cached.evaluate(traces)).toEqual(expected)
      expect(cached.lastRunStats).toEqual(uncached.lastRunStats)
      expect(cached.evaluate(traces)).toEqual(expected)
      expect(state.geometryCacheUnits).toBeGreaterThan(0)
      expect(
        state.geometryCacheUnits +
          state.primitiveKeyUnits +
          state.queryResultUnits,
      ).toBeLessThanOrEqual(budget)
    }
    const before = keys.mock.calls.length
    cached.evaluate(traces)
    expect(keys.mock.calls.length - before).toBeLessThan(traces.length)
  } finally {
    keys.mockRestore()
  }
})
