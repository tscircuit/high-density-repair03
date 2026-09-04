import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

const srj: SimpleRouteJson = {
  bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  connections: [],
  obstacles: [
    {
      type: "rect",
      center: { x: 1, y: 1 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["pcb_smtpad_0", "pad_net"],
    },
  ],
}

const createTraces = (): SimplifiedPcbTraces => [
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_a",
    connection_name: "net_a",
    route: [
      {
        route_type: "wire",
        x: -2,
        y: 0,
        layer: "top",
        width: 0.1,
        start_pcb_port_id: "pcb_port_a",
      },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_b",
    connection_name: "net_b",
    route: [
      { route_type: "wire", x: 0, y: -2, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 2, layer: "top", width: 0.1 },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_c",
    connection_name: "net_c",
    route: [
      { route_type: "wire", x: 1, y: 1.3, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 1,
        y: 1.3,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
      { route_type: "wire", x: 1, y: 1.3, layer: "bottom", width: 0.1 },
    ],
  },
]

test("last-result reuse is exact, mutation-safe, mode-specific and bounded", () => {
  const changes: Array<(traces: SimplifiedPcbTraces) => void> = [
    (traces) => {
      const point = traces[0]!.route[1]!
      if (point.route_type === "wire") point.y = 0.3
    },
    (traces) => {
      const point = traces[0]!.route[0]!
      if (point.route_type === "wire") point.width = 0.2
    },
    (traces) => {
      for (const point of traces[1]!.route) {
        if (point.route_type === "wire") point.layer = "bottom"
      }
    },
    (traces) => {
      traces[0]!.pcb_trace_id = "renamed_trace"
    },
    (traces) => {
      traces[0]!.connection_name = "net_b"
    },
    (traces) => {
      const point = traces[0]!.route[0]!
      if (point.route_type === "wire") point.start_pcb_port_id = "new_port"
    },
    (traces) => {
      const point = traces[2]!.route[1]!
      if (point.route_type === "via") point.via_diameter = 0.5
    },
    (traces) => {
      const point = traces[2]!.route[1]!
      if (point.route_type === "via") point.from_layer = "inner1"
    },
  ]
  for (const change of changes) {
    const traces = createTraces()
    const engine = new AutoroutingDrcEngine(srj)
    const expected = engine.evaluate(traces)
    expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
    expect(engine.evaluate(structuredClone(traces))).toEqual(expected)
    expect(engine.lastRunStats.exactCheckCount).toBe(0)
    change(traces)
    const changed = engine.evaluate(traces)
    expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
    expect(changed).toEqual(new AutoroutingDrcEngine(srj).evaluate(traces))
    expect(changed).not.toEqual(expected)
  }

  const traces = createTraces()
  const engine = new AutoroutingDrcEngine(srj)
  const result = engine.evaluate(traces)
  const expected = structuredClone(result)
  result.errors[0]!.center!.x = 1000
  const returnedPortIds = result.errors[0]!.pcb_port_ids as string[]
  returnedPortIds.push("mutated_port")
  result.errors.length = 0
  const cached = engine.evaluate(traces)
  expect(cached).toEqual(expected)
  expect(engine.lastRunStats.broadPhaseCandidateCount).toBe(0)
  expect(engine.lastRunStats.exactCheckCount).toBe(0)
  expect(cached.errorsWithCenters[0]).toBe(cached.errors[0])
  expect(cached.errorsWithCenters).toBe(cached.locationAwareErrors)
  cached.errorsWithCenters[0]!.center!.y = 1000
  expect(engine.evaluate(traces)).toEqual(expected)

  // Trace-via errors originally share their port array with collected segments.
  // Mutating that returned array must not make a changed input look cached.
  const viaTraces = createTraces()
  for (const point of viaTraces[2]!.route) {
    if (point.route_type !== "jumper") point.y = 0.1
  }
  const viaEngine = new AutoroutingDrcEngine(srj)
  const viaResult = viaEngine.evaluate(viaTraces)
  const viaError = viaResult.errors.find(
    (error) => error.pcb_trace_error_id === "overlap_trace_a_via_0",
  )!
  expect(viaError).toBeDefined()
  const viaErrorPortIds = viaError.pcb_port_ids as string[]
  viaErrorPortIds.push("new_port")
  const endpoint = viaTraces[0]!.route[1]!
  if (endpoint.route_type === "wire") endpoint.end_pcb_port_id = "new_port"
  expect(viaEngine.evaluate(viaTraces)).toEqual(
    new AutoroutingDrcEngine(srj).evaluate(viaTraces),
  )
  expect(viaEngine.lastRunStats.exactCheckCount).toBeGreaterThan(0)

  const legacy = engine.evaluateLegacy(traces)
  expect(legacy.errors).toHaveLength(1)
  expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
  expect(engine.evaluateLegacy(traces)).toEqual(legacy)
  expect(engine.lastRunStats.exactCheckCount).toBe(0)
  expect(engine.evaluate(traces)).toEqual(expected)
  expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)

  const other = createTraces()
  other[0]!.pcb_trace_id = "another_candidate"
  engine.evaluate(other)
  engine.evaluate(traces)
  expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)

  // This clear trace has metadata larger than the eight-MiB cache payload budget.
  // It must evict, rather than retain, the preceding full-board result.
  const oversized = createTraces().slice(0, 1)
  oversized[0]!.pcb_trace_id = "x".repeat(5 * 1024 * 1024)
  expect(engine.evaluate(oversized).errors).toEqual([])
  expect(engine.evaluate(traces)).toEqual(expected)
  expect(engine.lastRunStats.exactCheckCount).toBeGreaterThan(0)
})
