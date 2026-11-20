import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"

test("AutoroutingDrcEngine checks the wire segment leaving a via across obstacles, traces, and vias", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 4, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    connections: [
      { name: "net_a", pointsToConnect: [] },
      { name: "net_b", pointsToConnect: [] },
      { name: "net_c", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 1.5, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_foreign_bottom"],
      },
    ],
  }

  const hdPoints = [
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 3, y: 0, z: 1 },
  ]

  const convertedRoute = convertHdRouteToSimplifiedRoute(hdPoints, 2, {
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  // convertHdRouteToSimplifiedRoute emits wire -> via -> wire without a duplicate wire at the via
  expect(convertedRoute.map((point) => point.route_type)).toEqual([
    "wire",
    "wire",
    "via",
    "wire",
  ])

  const tracesFromConverter: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "net_a",
      route: convertedRoute,
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      connection_name: "net_b",
      route: [
        { route_type: "wire", x: 2.2, y: -0.5, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 2.2, y: 0.5, width: 0.1, layer: "bottom" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_c",
      connection_name: "net_c",
      route: [
        { route_type: "wire", x: 2.7, y: -0.5, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2.7, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 2.7,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 2.7, y: 0.5, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  const tracesWithExplicitPostViaWire: SimplifiedPcbTraces =
    structuredClone(tracesFromConverter)
  tracesWithExplicitPostViaWire[0]!.route.splice(3, 0, {
    route_type: "wire",
    x: 0,
    y: 0,
    width: 0.1,
    layer: "bottom",
  })

  const engine = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  })
  const result = engine.evaluate(tracesFromConverter)
  const converterStats = { ...engine.lastRunStats }

  const errorIds = result.errors.map((error) => error.pcb_trace_error_id)
  expect(errorIds).toContain("overlap_trace_a_pcb_smtpad_foreign_bottom")
  expect(errorIds).toContain("overlap_trace_a_trace_b")
  expect(errorIds).toContain("overlap_trace_a_via_1")

  const obstacleContacts = engine.getObstacleContactErrors(
    tracesFromConverter,
    new Set(["trace_a"]),
  )
  expect(obstacleContacts.map((error) => error.pcb_trace_error_id)).toEqual([
    "overlap_trace_a_pcb_smtpad_foreign_bottom",
  ])

  const explicitResult = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  })
  const evaluatedExplicit = explicitResult.evaluate(
    tracesWithExplicitPostViaWire,
  )
  expect(evaluatedExplicit.errors).toEqual(result.errors)
  expect(explicitResult.lastRunStats.segmentCount).toBe(
    converterStats.segmentCount,
  )
})

test("GlobalDrcForceImproveSolver does not drag a post-via wire segment across a foreign SMT pad", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 4, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    connections: [{ name: "sig", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -0.22 },
        width: 0.4,
        height: 0.2,
        connectedTo: ["pcb_smtpad_top_pusher"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 1.5, y: 0.28 },
        width: 0.6,
        height: 0.3,
        connectedTo: ["pcb_smtpad_bottom_blocker"],
      },
    ],
  }

  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "sig",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1.5, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
      ],
    },
  ]

  const engine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    autoroutingDrcEngine: engine,
    maxIterations: 16,
  })
  solver.solve()
  const output = solver.getOutput()
  const outputTraces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "sig_0",
      connection_name: "sig",
      route: convertHdRouteToSimplifiedRoute(output[0]!.route, 2, {
        traceThickness: 0.1,
        viaDiameter: 0.3,
      }),
    },
  ]
  const padOverlaps = engine
    .evaluate(outputTraces)
    .errors.filter(
      (error) =>
        error.pcb_smtpad_id === "pcb_smtpad_bottom_blocker" &&
        Number(error.actual_clearance) < 0,
    )
  expect(padOverlaps).toEqual([])
})
