import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("DRC checks the full drilled stack when buried vias are disabled", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_net",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
          layers: ["top", "inner1", "inner2"],
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "other_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const originalTraces = structuredClone(traces)

  expect(
    new AutoroutingDrcEngine(srj).evaluate(traces).errors.length,
  ).toBeGreaterThan(0)
  expect(
    convertToCircuitJson(srj, traces).find(
      (element) => element.type === "pcb_via",
    )?.layers,
  ).toEqual(["top", "inner1", "inner2", "bottom"])

  const buriedSrj = { ...srj, allowBlindAndBuriedVias: true }
  expect(new AutoroutingDrcEngine(buriedSrj).evaluate(traces).errors).toEqual(
    [],
  )
  expect(
    convertToCircuitJson(buriedSrj, traces).find(
      (element) => element.type === "pcb_via",
    )?.layers,
  ).toEqual(["top", "inner1", "inner2"])
  expect(traces).toEqual(originalTraces)
  const convertedViaTrace = convertToCircuitJson(srj, traces).find(
    (element) =>
      element.type === "pcb_trace" && element.pcb_trace_id === "via_trace",
  )
  if (convertedViaTrace?.type !== "pcb_trace") {
    throw new Error("Expected the converted via trace")
  }
  expect(convertedViaTrace.route[0]).toMatchObject({
    from_layer: "top",
    to_layer: "inner2",
  })
})
