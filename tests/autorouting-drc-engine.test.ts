import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "../lib"
import { getDrcErrors } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

const getErrorKey = (error: Record<string, unknown>) =>
  [error.type, error.pcb_trace_error_id ?? error.pcb_error_id].join(":")

test("matches the relaxed reference checks for autorouting collision types", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 4, maxY: 2 },
    connections: [
      { name: "net_a", pointsToConnect: [] },
      { name: "net_b", pointsToConnect: [] },
      { name: "net_c", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "net_a",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 3, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      connection_name: "net_b",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -0.5,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 0,
          y: 0.5,
          width: 0.1,
          layer: "top",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_c",
      connection_name: "net_c",
      route: [
        {
          route_type: "wire",
          x: 1,
          y: -0.5,
          width: 0.1,
          layer: "top",
        },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
        {
          route_type: "wire",
          x: 1,
          y: 0.5,
          width: 0.1,
          layer: "bottom",
        },
      ],
    },
  ]

  const engineResult = new AutoroutingDrcEngine(srj).evaluate(traces)
  const referenceResult = getDrcErrors(
    convertToCircuitJson(srj, traces, 0.1, 0.3),
    { traceClearance: 0.1, viaClearance: 0.1 },
  )

  expect(new Set(engineResult.errors.map(getErrorKey))).toEqual(
    new Set(
      referenceResult.errors.map((error) =>
        getErrorKey(error as unknown as Record<string, unknown>),
      ),
    ),
  )
  expect(engineResult.locationAwareErrors.length).toBe(
    engineResult.errors.length,
  )

  const tracePairError = engineResult.errors.find(
    (error) =>
      error.pcb_trace_error_id === "overlap_trace_a_trace_b" ||
      error.pcb_trace_error_id === "overlap_trace_b_trace_a",
  )
  expect(tracePairError?.pcb_trace_ids).toEqual(["trace_a", "trace_b"])

  const traceViaError = engineResult.errors.find(
    (error) => error.pcb_via_trace_id === "trace_c",
  )
  expect(traceViaError?.pcb_trace_ids).toEqual(["trace_a", "trace_c"])

  const obstacleError = engineResult.errors.find(
    (error) => error.pcb_obstacle_id === "pcb_smtpad_foreign",
  )
  expect(obstacleError?.pcb_trace_ids).toEqual(["trace_a"])
})

test("classifies close via pairs by canonical SRJ net", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    connections: [
      {
        name: "shared_mst0",
        rootConnectionName: "shared",
        pointsToConnect: [],
      },
      {
        name: "shared_mst1",
        rootConnectionName: "shared",
        pointsToConnect: [],
      },
      { name: "foreign", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const createViaTrace = (
    traceId: string,
    connectionName: string,
    x: number,
  ): SimplifiedPcbTraces[number] => ({
    type: "pcb_trace",
    pcb_trace_id: traceId,
    connection_name: connectionName,
    route: [
      { route_type: "wire", x, y: -0.5, width: 0.1, layer: "top" },
      { route_type: "wire", x, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
      { route_type: "wire", x, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x, y: 0.5, width: 0.1, layer: "bottom" },
    ],
  })
  const result = new AutoroutingDrcEngine(srj).evaluate([
    createViaTrace("trace_0", "shared_mst0", 0),
    createViaTrace("trace_1", "shared_mst1", 0.2),
    createViaTrace("trace_2", "foreign", 0.4),
  ])
  const viaErrorIds = result.errors
    .map((error) => error.pcb_error_id)
    .filter((id): id is string => typeof id === "string")

  expect(viaErrorIds).toContain("same_net_vias_close_via_0_via_1")
  expect(viaErrorIds).toContain("different_net_vias_close_via_1_via_2")
  expect(
    result.errors.find(
      (error) => error.pcb_error_id === "different_net_vias_close_via_1_via_2",
    )?.pcb_trace_ids,
  ).toEqual(["trace_1", "trace_2"])
})

test("uses an injected connectivity map for equivalent net identifiers", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [
      { name: "route_a", pointsToConnect: [] },
      { name: "route_b", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const traces: SimplifiedPcbTraces = ["route_a", "route_b"].map(
    (connectionName, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: connectionName,
      route: [
        {
          route_type: "wire",
          x: index * 0.2,
          y: -0.5,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: index * 0.2,
          y: 0,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "via",
          x: index * 0.2,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        {
          route_type: "wire",
          x: index * 0.2,
          y: 0,
          width: 0.1,
          layer: "bottom",
        },
        {
          route_type: "wire",
          x: index * 0.2,
          y: 0.5,
          width: 0.1,
          layer: "bottom",
        },
      ],
    }),
  )
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["route_a", "shared_net"],
    ["route_b", "shared_net"],
  ])

  const result = new AutoroutingDrcEngine(srj, { connMap }).evaluate(traces)
  const viaError = result.errors.find(
    (error) => error.type === "pcb_via_clearance_error",
  )

  expect(viaError?.pcb_error_id).toBe("same_net_vias_close_via_0_via_1")
})

test("uses the spatial broad phase instead of comparing every trace pair", () => {
  const traceCount = 250
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: traceCount * 2 },
    connections: Array.from({ length: traceCount }, (_, index) => ({
      name: `net_${index}`,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const traces: SimplifiedPcbTraces = Array.from(
    { length: traceCount },
    (_, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: `net_${index}`,
      route: [
        {
          route_type: "wire",
          x: 0,
          y: index * 2,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 0.5,
          y: index * 2,
          width: 0.1,
          layer: "top",
        },
      ],
    }),
  )
  const engine = new AutoroutingDrcEngine(srj)
  const result = engine.evaluate(traces)

  expect(result.errors).toHaveLength(0)
  expect(engine.lastRunStats.exactCheckCount).toBeLessThan(traceCount * 10)
  expect(engine.lastRunStats.exactCheckCount).toBeLessThan(
    (traceCount * (traceCount - 1)) / 2,
  )
})

test("the repair solver uses an injected AutoroutingDrcEngine", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [{ name: "net", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "net",
      route: [
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    autoroutingDrcEngine: engine,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(engine.lastRunStats.traceCount).toBe(1)
  expect(getDrcSnapshot(srj, routes).count).toBe(0)
})
