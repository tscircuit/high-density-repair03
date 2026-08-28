import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimplifiedPcbTraces,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

test("direct HD-route evaluators skip trace conversion without losing ownership", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "alpha", pointsToConnect: [] },
      { name: "beta", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "beta",
      route: [
        { x: -1, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "alpha",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "beta",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const directTraceCounts: number[] = []
  const directEvaluator: DrcEvaluator = ({ traces, routes }) => {
    directTraceCounts.push(traces.length)
    expect(routes).toBe(hdRoutes)
    return { errors: [], errorsWithCenters: [] }
  }
  directEvaluator.consumesHdRoutesDirectly = true
  const portfolio = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator: directEvaluator,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

  expect(portfolio.legacyDrcEvaluator.consumesHdRoutesDirectly).toBe(true)
  const directSnapshot = getDrcSnapshot(
    srj,
    hdRoutes,
    portfolio.legacyDrcEvaluator,
  )
  expect(directTraceCounts).toEqual([0])
  expect(Object.fromEntries(directSnapshot.traceRouteIndexById)).toEqual({
    alpha_0: 1,
    beta_0: 0,
    beta_1: 2,
  })

  let materializedTraces: SimplifiedPcbTraces | undefined
  const genericEvaluator: DrcEvaluator = ({ traces }) => {
    materializedTraces = traces
    return { errors: [], errorsWithCenters: [] }
  }
  const genericSnapshot = getDrcSnapshot(srj, hdRoutes, genericEvaluator)
  expect(materializedTraces?.map((trace) => trace.pcb_trace_id)).toEqual([
    "alpha_0",
    "beta_0",
    "beta_1",
  ])
  expect(Object.fromEntries(genericSnapshot.traceRouteIndexById)).toEqual(
    Object.fromEntries(directSnapshot.traceRouteIndexById),
  )

  let legacyOverrideTraceCount: number | undefined
  const directWithLegacyOverride: DrcEvaluator = () => ({ errors: [] })
  directWithLegacyOverride.consumesHdRoutesDirectly = true
  directWithLegacyOverride.evaluateLegacy = ({ traces }) => {
    legacyOverrideTraceCount = traces.length
    return { errors: [], errorsWithCenters: [] }
  }
  const overridePortfolio = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator: directWithLegacyOverride,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  expect(
    overridePortfolio.legacyDrcEvaluator.consumesHdRoutesDirectly,
  ).toBeUndefined()
  getDrcSnapshot(srj, hdRoutes, overridePortfolio.legacyDrcEvaluator)
  expect(legacyOverrideTraceCount).toBe(3)
})
