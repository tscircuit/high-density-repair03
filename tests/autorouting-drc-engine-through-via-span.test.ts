import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import { collectViaNodes } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

test("expands partial transitions through the full stack when blind vias are disabled", () => {
  const createSrj = (allowBlindAndBuriedVias: boolean): SimpleRouteJson => ({
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [
      { name: "partial_via_net", pointsToConnect: [] },
      { name: "bottom_trace_net", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 4,
    allowBlindAndBuriedVias,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  })
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "partial_via_trace",
      connection_name: "partial_via_net",
      route: [
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        {
          route_type: "wire",
          x: 0.5,
          y: 0,
          width: 0.1,
          layer: "inner1",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "bottom_trace_net",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -0.5,
          width: 0.1,
          layer: "bottom",
        },
        {
          route_type: "wire",
          x: 0,
          y: 0.5,
          width: 0.1,
          layer: "bottom",
        },
      ],
    },
  ]

  const throughViaResult = new AutoroutingDrcEngine(createSrj(false), {
    includeTraceViaOwnerMetadata: true,
  }).evaluate(traces)
  const blindViaResult = new AutoroutingDrcEngine(createSrj(true), {
    includeTraceViaOwnerMetadata: true,
  }).evaluate(traces)

  expect(throughViaResult.errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_trace_error",
      pcb_trace_id: "bottom_trace",
      pcb_trace_ids: ["bottom_trace", "partial_via_trace"],
      pcb_via_id: "via_0",
      pcb_via_ids: ["via_0"],
    }),
  )
  expect(blindViaResult.errors).toHaveLength(0)

  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "partial_via_net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -0.5, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 1 },
      ],
    },
  ]
  expect(collectViaNodes(hdRoutes, 0.3, createSrj(false))[0]?.zLayers).toEqual([
    0, 1, 2, 3,
  ])
  expect(collectViaNodes(hdRoutes, 0.3, createSrj(true))[0]?.zLayers).toEqual([
    0, 1,
  ])
})
