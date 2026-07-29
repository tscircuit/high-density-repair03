import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc"
import {
  attemptBoundedLocalReroute,
  DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS,
} from "../lib/solvers/GlobalDrcForceImproveSolver/boundedLocalReroute"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import type { SimpleRouteJson } from "../lib/types/srj-types"

const srj: SimpleRouteJson = {
  bounds: { minX: -2.5, minY: -0.6, maxX: 2.5, maxY: 0.6 },
  connections: [
    { name: "primary", pointsToConnect: [] },
    { name: "crossing", pointsToConnect: [] },
  ],
  obstacles: [
    {
      obstacleId: "bottom-pad",
      type: "rect",
      layers: ["bottom"],
      center: { x: 0, y: 0 },
      width: 0.3,
      height: 0.3,
      connectedTo: ["pcb_smtpad_blocker"],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.1,
  minViaEdgeToPadEdgeClearance: 0.1,
}

const createRoutes = (): HighDensityRoute[] => [
  {
    connectionName: "primary",
    rootConnectionName: "primary",
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1.5, y: 0, z: 0 },
      { x: -0.8, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "crossing",
    rootConnectionName: "crossing",
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
]

const error = {
  type: "pcb_trace_error",
  pcb_trace_id: "primary_0",
  pcb_trace_error_id: "overlap_primary_0_crossing_0",
  center: { x: 0, y: 0 },
}

test("reroutes only a bounded conflict span through a constrained layer-aware corridor", () => {
  const routes = createRoutes()
  const unchangedForeignRoute = structuredClone(routes[1])
  const engine = new AutoroutingDrcEngine(srj)
  const result = attemptBoundedLocalReroute({
    srj,
    routes,
    error,
    traceRouteIndexById: new Map([
      ["primary_0", 0],
      ["crossing_0", 1],
    ]),
    autoroutingDrcEngine: engine,
  })

  expect(result.routes).toBeDefined()
  expect(result.canonicalSnapshot?.count).toBe(0)
  expect(result.routes?.[1]).toEqual(unchangedForeignRoute)
  expect(result.routes?.[0]?.route[0]).toEqual(routes[0]?.route[0])
  expect(result.routes?.[0]?.route.at(-1)).toEqual(routes[0]?.route.at(-1))
  expect(result.routes?.[0]?.vias).toHaveLength(2)
  expect(result.routes?.[0]?.route.some((point) => point.z === 1)).toBe(true)
  expect(result.attemptedRouteSides).toEqual([0, 1])
  expect(result.generatedPathCount).toBeLessThanOrEqual(
    DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS.maxGeneratedPaths,
  )
  expect(result.graphNodeCount).toBeLessThanOrEqual(
    DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS.maxTotalGraphNodes,
  )
  expect(result.candidateEvaluationCount).toBeLessThanOrEqual(
    DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS.maxCandidateEvaluations,
  )
  expect(result.canonicalEvaluationCount).toBeLessThanOrEqual(
    DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS.maxCanonicalEvaluations,
  )
  expect(getDrcSnapshot(srj, result.routes ?? routes).count).toBe(0)
})

test("returns without mutation when the strict graph budget is exhausted", () => {
  const routes = createRoutes()
  const originalRoutes = structuredClone(routes)
  const result = attemptBoundedLocalReroute({
    srj,
    routes,
    error,
    traceRouteIndexById: new Map([
      ["primary_0", 0],
      ["crossing_0", 1],
    ]),
    autoroutingDrcEngine: new AutoroutingDrcEngine(srj),
    budgets: {
      ...DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS,
      maxGraphNodesPerSearch: 1,
      maxTotalGraphNodes: 2,
    },
  })

  expect(result.routes).toBeUndefined()
  expect(result.graphNodeCount).toBeLessThanOrEqual(2)
  expect(routes).toEqual(originalRoutes)
})
