import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("repairs an exact via-trace pair when its reported center is distant", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: -1, y: 0.8, z: 0 },
        { x: 0, y: 0.8, z: 0 },
        { x: 1, y: 0.8, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: "via_0",
        pcb_trace_id: "source_net_2_mst0_0",
        center: { x: 0, y: 0 },
      },
    ],
    new Map([["source_net_2_mst0_0", 1]]),
    1,
  )

  expect(changed).toBe(true)
  expect(routes[1]?.route[1]?.y).not.toBe(0.8)
})

test("opts into promoted via-owner targeting while retaining the legacy default", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "owner", pointsToConnect: [] },
      { name: "unrelated", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const initialRoutes = cloneRoutes([
    {
      connectionName: "owner",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0.3, y: 0, z: 0 },
        { x: 0.3, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0.3, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "unrelated",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])
  const originalOwnerRoute = structuredClone(initialRoutes[0]!.route)
  const originalUnrelatedRoute = structuredClone(initialRoutes[1]!.route)
  const error = {
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    pcb_trace_id: "owner_0",
    pcb_trace_ids: ["fixed_trace", "owner_0"],
    pcb_via_id: "offending_owner_via",
    pcb_via_ids: ["offending_owner_via"],
    center: { x: 0, y: 0 },
  }
  const traceRouteIndexById = new Map([
    ["owner_0", 0],
    ["unrelated_0", 1],
  ])
  const legacyRoutes = cloneRoutes(initialRoutes)

  const legacyChanged = applyDrcErrorForces(
    srj,
    legacyRoutes,
    [error],
    traceRouteIndexById,
    1,
  )

  expect(legacyChanged).toBe(true)
  expect(legacyRoutes[0]?.route).not.toEqual(originalOwnerRoute)
  expect(legacyRoutes[1]?.route).not.toEqual(originalUnrelatedRoute)

  const targetedRoutes = cloneRoutes(initialRoutes)
  const targetedChanged = applyDrcErrorForces(
    srj,
    targetedRoutes,
    [error],
    traceRouteIndexById,
    1,
    undefined,
    true,
    false,
    true,
    true,
  )

  expect(targetedChanged).toBe(true)
  expect(targetedRoutes[0]?.route).not.toEqual(originalOwnerRoute)
  expect(targetedRoutes[0]?.route[1]?.x).toBeGreaterThan(0.3)
  expect(targetedRoutes[1]?.route).toEqual(originalUnrelatedRoute)
})

test("keeps raw engine trace-via errors on the primary segment route", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "segment", pointsToConnect: [] },
      { name: "via_owner", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "segment",
      route: [
        { x: -1, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: 0.01, y: 0.1, z: 1 },
        { x: 0.01, y: 0.1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ],
      vias: [{ x: 0.01, y: 0.1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "via_owner",
      route: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0.25, z: 0 },
        { x: 0, y: 0.25, z: 1 },
        { x: 0.5, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 0.25 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "segment_0",
      connection_name: "segment",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "bottom" },
        {
          route_type: "wire",
          x: 0.01,
          y: 0.1,
          width: 0.1,
          layer: "bottom",
        },
        {
          route_type: "via",
          x: 0.01,
          y: 0.1,
          from_layer: "bottom",
          to_layer: "top",
          via_diameter: 0.3,
        },
        {
          route_type: "wire",
          x: 0.01,
          y: 0.1,
          width: 0.1,
          layer: "top",
        },
        { route_type: "wire", x: -1, y: 1, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "via_owner_0",
      connection_name: "via_owner",
      route: [
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0.25, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0.25,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        {
          route_type: "wire",
          x: 0,
          y: 0.25,
          width: 0.1,
          layer: "bottom",
        },
        { route_type: "wire", x: 0.5, y: 1, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const rawError = new AutoroutingDrcEngine(srj)
    .evaluate(traces)
    .errors.find(
      (error) =>
        error.pcb_trace_id === "segment_0" && Array.isArray(error.pcb_via_ids),
    )
  expect(rawError).toBeDefined()
  const originalSegmentRoute = structuredClone(routes[0]!.route)
  const originalViaOwnerRoute = structuredClone(routes[1]!.route)

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [rawError!],
    new Map([
      ["segment_0", 0],
      ["via_owner_0", 1],
    ]),
    1,
    undefined,
    true,
    false,
    true,
    true,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route).not.toEqual(originalSegmentRoute)
  expect(routes[1]?.route).toEqual(originalViaOwnerRoute)
})
