import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import {
  applyDrcErrorForces,
  getDrcErrorRouteIndexes,
  getRouteDisjointDrcErrorBatch,
  getTraceRoutePairForError,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getBackoffForceScaleForIteration } from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

const createPadError = (traceId: string, center: { x: number; y: number }) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_id: traceId,
  pcb_trace_ids: [traceId],
  pcb_obstacle_id: `pad_${traceId}`,
  message: `PCB trace ${traceId} overlaps with pcb_smtpad "pad_${traceId}" (gap: -0.050mm)`,
  center,
})

test("selects a spatially separated set with disjoint route ownership", () => {
  const traceRouteIndexById = new Map([
    ["trace_a", 0],
    ["trace_b", 1],
    ["trace_c", 2],
    ["trace_d", 3],
  ])
  const first = createPadError("trace_a", { x: 0, y: 0 })
  const sameRoute = createPadError("trace_a", { x: 5, y: 0 })
  const separated = createPadError("trace_c", { x: 2, y: 0 })
  const tooClose = createPadError("trace_d", { x: 2.2, y: 0 })

  const batch = getRouteDisjointDrcErrorBatch(
    [first, sameRoute, separated, tooClose],
    traceRouteIndexById,
    1,
  )

  expect(batch.errors).toEqual([first, separated])
  expect(batch.routeIndexes).toEqual([0, 2])
})

test("resolves every explicit trace participant to its owning route", () => {
  const routeIndexes = getDrcErrorRouteIndexes(
    {
      type: "pcb_via_clearance_error",
      pcb_trace_ids: ["trace_a", "trace_b"],
      pcb_via_trace_ids: ["trace_a", "trace_b"],
      pcb_via_ids: ["via_0", "via_1"],
      center: { x: 0, y: 0 },
    },
    new Map([
      ["trace_a", 4],
      ["trace_b", 9],
    ]),
  )

  expect(routeIndexes).toEqual([4, 9])
})

test("keeps batch-only ownership out of precise pair semantics", () => {
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_a",
    pcb_trace_error_id: "overlap_trace_a_via_b",
    route_owner_trace_ids: ["trace_a", "trace_b"],
    center: { x: 0, y: 0 },
  }
  const traceRouteIndexById = new Map([
    ["trace_a", 4],
    ["trace_b", 9],
  ])

  expect(getDrcErrorRouteIndexes(error, traceRouteIndexById)).toEqual([4, 9])
  expect(getTraceRoutePairForError(error, traceRouteIndexById)).toBeUndefined()
})

test("batch ownership scoping does not change precise candidate behavior", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "trace_route", pointsToConnect: [] },
      { name: "via_route", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pad"],
        obstacleId: "pad",
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "trace_route",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "via_route",
      route: [
        { x: -1, y: 0.1, z: 0 },
        { x: 0, y: 0.1, z: 0 },
        { x: 0, y: 0.1, z: 1 },
        { x: 1, y: 0.1, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const error = {
    ...createPadError("trace_route_0", { x: 0, y: 0 }),
    pcb_obstacle_id: "pad",
  }
  const traceRouteIndexById = new Map([
    ["trace_route_0", 0],
    ["via_route_0", 1],
  ])
  const preciseRoutes = structuredClone(routes)
  const batchRoutes = structuredClone(routes)

  applyDrcErrorForces(srj, preciseRoutes, [error], traceRouteIndexById, 1)
  applyDrcErrorForces(
    srj,
    batchRoutes,
    [error],
    traceRouteIndexById,
    1,
    undefined,
    true,
    [0],
  )

  expect(preciseRoutes[1]!.route[1]).not.toEqual(routes[1]!.route[1])
  expect(batchRoutes[1]!.route).toEqual(routes[1]!.route)
})

const createLargeBoardMissScenario = () => {
  const activeRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "B",
      route: [
        { x: 0, y: 4, z: 0 },
        { x: 10, y: 4, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const emptyRoutes: HighDensityRoute[] = Array.from(
    { length: 119 },
    (_, index) => ({
      connectionName: `unused_${index}`,
      route: [],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const hdRoutes = [...activeRoutes, ...emptyRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 6 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad_a"],
        obstacleId: "pad_a",
      },
      {
        type: "rect",
        center: { x: 8, y: 4 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad_b"],
        obstacleId: "pad_b",
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = () => [
    createPadError("A_0", { x: 2, y: 0 }),
    createPadError("B_0", { x: 8, y: 4 }),
  ]

  return { srj, hdRoutes, drcEvaluator }
}

const createRejectedBatchScenario = () => {
  const activeRoutes: HighDensityRoute[] = Array.from(
    { length: 4 },
    (_, index) => ({
      connectionName: `route_${index}`,
      route: [
        { x: 0, y: index * 4, z: 0 },
        { x: 10, y: index * 4, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const emptyRoutes: HighDensityRoute[] = Array.from(
    { length: 117 },
    (_, index) => ({
      connectionName: `unused_${index}`,
      route: [],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const hdRoutes = [...activeRoutes, ...emptyRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 14 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: activeRoutes.map((route, index) => ({
      type: "rect",
      center: { x: index % 2 === 0 ? 2 : 8, y: index * 4 },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [`pad_${index}`],
      obstacleId: `pad_${route.connectionName}_0`,
    })),
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const errors = activeRoutes.map((route, index) =>
    createPadError(`${route.connectionName}_0`, {
      x: index % 2 === 0 ? 2 : 8,
      y: index * 4,
    }),
  )
  const drcEvaluator: DrcEvaluator = () => errors

  return { srj, hdRoutes, drcEvaluator }
}

test("allows a coarse pipeline stage to opt out of batched candidates", () => {
  const solver = new GlobalDrcForceImproveSolver({
    ...createLargeBoardMissScenario(),
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enableRouteDisjointBatching: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchAttempts).toBe(0)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(3)
})

test("uses precise candidates when the candidate budget covers every error", () => {
  const solver = new GlobalDrcForceImproveSolver({
    ...createLargeBoardMissScenario(),
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchAttempts).toBe(0)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(3)
})

test("uses precise search when the disjoint batch fits the candidate budget", () => {
  const scenario = createLargeBoardMissScenario()
  const inputRouteA = scenario.hdRoutes[0]
  const errors = [
    createPadError("A_0", { x: 2, y: 0 }),
    createPadError("B_0", { x: 8, y: 4 }),
    createPadError("A_0", { x: 5, y: 0 }),
    createPadError("B_0", { x: 5, y: 4 }),
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) =>
    routes?.[0] === inputRouteA ? errors : errors.slice(1)
  const solver = new GlobalDrcForceImproveSolver({
    ...scenario,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchAttempts).toBe(0)
  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchesAccepted).toBe(0)
  expect(solver.stats.finalDrcIssueCount).toBe(3)
})

test("does not charge a rejected disjoint batch to the precise candidate budget", () => {
  const solver = new GlobalDrcForceImproveSolver({
    ...createRejectedBatchScenario(),
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchAttempts).toBe(1)
  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchesAccepted).toBe(0)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBe(4)
  expect(solver.stats.finalDrcIssueCount).toBe(4)
})

test("does not batch when precise iterations can visit every initial error", () => {
  const solver = new GlobalDrcForceImproveSolver({
    ...createRejectedBatchScenario(),
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchAttempts).toBe(0)
  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchesAccepted).toBe(0)
})

test("rotates precise force scales after batch backoff", () => {
  expect(
    [1, 2, 3, 4].map((iteration) =>
      getBackoffForceScaleForIteration(1, iteration),
    ),
  ).toEqual([1, 1.75, -1, 1])
})
