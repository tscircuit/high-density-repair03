import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import {
  getDrcErrorRouteIndexes,
  getRouteDisjointDrcErrorBatch,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
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
