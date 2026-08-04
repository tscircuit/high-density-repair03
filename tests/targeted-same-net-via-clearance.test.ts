import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalDrcForceImproveSolver } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("canonicalizes same-net vias only in exact targeted repair", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_5_mst0", pointsToConnect: [] },
      { name: "source_net_5_mst1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const inputRoutes = [
    {
      connectionName: "source_net_5_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_5_mst1",
      route: [
        { x: -1, y: 0.05, z: 0 },
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0.05, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const routes = cloneRoutes(inputRoutes)
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["source_net_5_mst0", "source_net_5"],
    ["source_net_5_mst1", "source_net_5"],
  ])

  const viaClearanceErrors = [
    {
      type: "pcb_via_clearance_error",
      error_type: "pcb_via_clearance_error",
      pcb_error_id: "same_net_vias_close_via_0_via_1",
      pcb_via_ids: ["via_0", "via_1"],
      pcb_via_pair_net_relation: "same_net",
      center: { x: 0.025, y: 0 },
    },
  ]
  const changed = applyDrcErrorForces(
    srj,
    routes,
    viaClearanceErrors,
    new Map(),
    1,
    connMap,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]?.x).toBeLessThan(0)
  expect(routes[1]?.route[1]?.x).toBeGreaterThan(0.05)

  const exactRepairRoutes = cloneRoutes(inputRoutes)
  const exactRepairChanged = applyDrcErrorForces(
    srj,
    exactRepairRoutes,
    viaClearanceErrors,
    new Map(),
    1,
    connMap,
    true,
    true,
  )

  expect(exactRepairChanged).toBe(true)
  expect(exactRepairRoutes[0]?.route[1]).toMatchObject({ x: 0, y: 0 })
  expect(exactRepairRoutes[1]?.route[1]).toMatchObject({ x: 0, y: 0 })
})

test("canonicalizes an untagged stitching endpoint without moving a PCB terminal", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_5_mst0", pointsToConnect: [] },
      { name: "source_net_5_mst1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_5_mst0",
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_1" },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_5_mst1",
      route: [
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["source_net_5_mst0", "source_net_5"],
    ["source_net_5_mst1", "source_net_5"],
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_via_clearance_error",
        error_type: "pcb_via_clearance_error",
        pcb_error_id: "same_net_vias_close_via_0_via_1",
        pcb_via_ids: ["via_0", "via_1"],
        pcb_via_pair_net_relation: "same_net",
        center: { x: 0.025, y: 0 },
      },
    ],
    new Map(),
    1,
    connMap,
    true,
    true,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[0]).toMatchObject({
    x: 0,
    y: 0,
    pcb_port_id: "pcb_port_1",
  })
  expect(routes[1]?.route[0]).toMatchObject({ x: 0, y: 0 })
  expect(routes[1]?.route[1]).toMatchObject({ x: 0, y: 0 })
})

test("prioritizes exact same-net via canonicalization over a trace repair", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_5_mst0", pointsToConnect: [] },
      { name: "source_net_5_mst1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const inputRoutes = [
    {
      connectionName: "source_net_5_mst0",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_5_mst1",
      route: [
        { x: -1, y: 0.05, z: 0 },
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0, z: 1 },
        { x: 1, y: 0.05, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["source_net_5_mst0", "source_net_5"],
    ["source_net_5_mst1", "source_net_5"],
  ])
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    connMap,
    maxIterations: 1,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    drcEvaluator: ({ routes }) => {
      const leftVia = routes?.[0]?.route[1]
      const rightVia = routes?.[1]?.route[1]
      const viasAreCanonical =
        leftVia &&
        rightVia &&
        leftVia.x === rightVia.x &&
        leftVia.y === rightVia.y

      return [
        {
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_id: "source_net_5_mst0_0",
          pcb_trace_error_id: "overlap_source_net_5_mst0_0_source_net_5_mst1_0",
          center: { x: -0.5, y: 0 },
        },
        ...(viasAreCanonical
          ? []
          : [
              {
                type: "pcb_via_clearance_error",
                error_type: "pcb_via_clearance_error",
                pcb_error_id: "same_net_vias_close_via_0_via_1",
                pcb_via_ids: ["via_0", "via_1"],
                pcb_via_pair_net_relation: "same_net",
                center: { x: 0.025, y: 0 },
              },
            ]),
      ]
    },
  })

  solver.step()

  expect(solver.getOutput()[0]?.route[1]).toMatchObject({ x: 0, y: 0 })
  expect(solver.getOutput()[1]?.route[1]).toMatchObject({ x: 0, y: 0 })
})
