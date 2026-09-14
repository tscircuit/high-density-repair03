import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("uses Core's through-via geometry unless blind and buried vias are enabled", (): void => {
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
      pcb_trace_id: "power",
      connection_name: "power",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  for (const allowBlindAndBuriedVias of [undefined, false]) {
    srj.allowBlindAndBuriedVias = allowBlindAndBuriedVias
    expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toHaveLength(
      1,
    )
    expect(
      convertToCircuitJson(srj, traces).find(
        (element) => element.type === "pcb_via",
      ),
    ).toMatchObject({ layers: ["top", "inner1", "inner2", "bottom"] })
  }

  srj.allowBlindAndBuriedVias = true
  expect(new AutoroutingDrcEngine(srj).evaluate(traces).errors).toEqual([])
  expect(
    convertToCircuitJson(srj, traces).find(
      (element) => element.type === "pcb_via",
    ),
  ).toMatchObject({ layers: ["top", "inner1", "inner2"] })
})
