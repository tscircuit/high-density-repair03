import { expect, test } from "bun:test"
import {
  cloneRoutesForIndexes,
  createDrcTraceCache,
  getDrcSnapshot,
  materializeRoutesForIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  HighDensityRoute,
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "../lib"
import type { DrcPhaseTimings } from "../lib/solvers/GlobalDrcForceImproveSolver/types"

test("reuses simplified traces for unchanged route objects", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 3, maxY: 2 },
    connections: [
      { name: "route_0", pointsToConnect: [] },
      { name: "route_1", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route_1",
      route: [
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "route_0",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const cache = createDrcTraceCache(srj, routes)
  const phaseTimings: DrcPhaseTimings = {
    cloningMs: 0,
    forceApplicationMs: 0,
    materializationMs: 0,
    traceConversionMs: 0,
    drcEvaluationMs: 0,
  }
  const evaluations: SimplifiedPcbTraces[] = []
  const evaluate = ({ traces }: { traces: SimplifiedPcbTraces }) => {
    evaluations.push(traces)
    return []
  }

  getDrcSnapshot(srj, routes, evaluate, undefined, undefined, cache, phaseTimings)

  const candidateRoutes = cloneRoutesForIndexes(routes, [0])
  candidateRoutes[0]!.route = [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 1, z: 1 },
    { x: 1, y: 1, z: 1 },
  ]
  const materializedCandidateRoutes = materializeRoutesForIndexes(
    candidateRoutes,
    [0],
  )
  getDrcSnapshot(
    srj,
    materializedCandidateRoutes,
    evaluate,
    undefined,
    undefined,
    cache,
    phaseTimings,
  )

  expect(evaluations[0]!.map((trace) => trace.pcb_trace_id)).toEqual([
    "route_0_0",
    "route_1_0",
  ])
  expect(evaluations[1]![0]).toBe(evaluations[0]![0])
  expect(evaluations[1]![1]).not.toBe(evaluations[0]![1])
  expect(phaseTimings.traceConversionMs).toBeGreaterThanOrEqual(0)
  expect(phaseTimings.drcEvaluationMs).toBeGreaterThanOrEqual(0)
})
