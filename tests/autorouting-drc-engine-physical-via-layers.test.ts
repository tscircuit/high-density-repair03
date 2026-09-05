import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { getPhysicalViaLayers } from "../lib/utils/getPhysicalViaLayers"

test("DRC uses physical via spans for through, blind and buried vias", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaDiameter: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via",
      connection_name: "power",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.2,
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0, layer: "bottom", width: 0.12 },
        { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.12 },
      ],
    },
  ]
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const result = new AutoroutingDrcEngine({
      ...srj,
      allowBlindAndBuriedVias,
    }).evaluate(traces)
    expect(result.errors.length > 0).toBe(allowBlindAndBuriedVias !== true)
  }
  const explicitSpan = structuredClone(traces)
  const explicitVia = explicitSpan[0]!.route[0]!
  if (explicitVia.route_type !== "via") throw new Error("Expected via")
  explicitVia.layers = ["top", "inner1", "inner2", "bottom"]
  expect(
    new AutoroutingDrcEngine({
      ...srj,
      allowBlindAndBuriedVias: true,
    }).evaluate(explicitSpan).errors.length,
  ).toBeGreaterThan(0)

  // The pedometer's fourth case has a positive gap, but less than clearance.
  const clearance = structuredClone(traces)
  for (const point of clearance[1]!.route)
    if (point.route_type === "wire") point.y = 0.2
  expect(
    new AutoroutingDrcEngine(srj, { viaClearance: 0.05 }).evaluate(clearance)
      .errors.length,
  ).toBeGreaterThan(0)

  const intermediate = structuredClone(traces)
  const via = intermediate[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected via")
  via.to_layer = "inner2"
  for (const point of intermediate[1]!.route)
    if (point.route_type === "wire") point.layer = "inner1"
  expect(
    new AutoroutingDrcEngine({
      ...srj,
      allowBlindAndBuriedVias: true,
    }).evaluate(intermediate).errors.length,
  ).toBeGreaterThan(0)
  intermediate[1]!.connection_name = "power"
  expect(
    new AutoroutingDrcEngine(srj).evaluate(intermediate).errors,
  ).toHaveLength(0)

  const viaPair: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "a",
      connection_name: "a",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
          via_diameter: 0.2,
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "b",
      connection_name: "b",
      route: [
        {
          route_type: "via",
          x: 0.12,
          y: 0,
          from_layer: "inner1",
          to_layer: "bottom",
          via_diameter: 0.2,
        },
      ],
    },
  ]
  expect(
    new AutoroutingDrcEngine({
      ...srj,
      allowBlindAndBuriedVias: true,
    }).evaluate(viaPair).errors.length,
  ).toBeGreaterThan(0)
  const padSrj: SimpleRouteJson = {
    ...srj,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0.25, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_other", "other"],
      },
    ],
  }
  expect(
    new AutoroutingDrcEngine(padSrj).evaluate([traces[0]!]).errors.length,
  ).toBeGreaterThan(0)

  expect(
    getPhysicalViaLayers({
      layerCount: 6,
      fromLayer: "inner3",
      toLayer: "inner1",
      allowBlindAndBuriedVias: true,
    }),
  ).toEqual(["inner1", "inner2", "inner3"])
  expect(
    getPhysicalViaLayers({
      layerCount: 4,
      fromLayer: "top",
      toLayer: "inner1",
      allowBlindAndBuriedVias: true,
      physicalLayers: ["inner2", "top", "inner1"],
    }),
  ).toEqual(["top", "inner1", "inner2"])
  expect(() =>
    getPhysicalViaLayers({
      layerCount: 4,
      fromLayer: "top",
      toLayer: "inner2",
      allowBlindAndBuriedVias: true,
      physicalLayers: ["top", "inner2"],
    }),
  ).toThrow("contiguous")
})
