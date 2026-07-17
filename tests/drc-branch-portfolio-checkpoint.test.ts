import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("selects a clean protected checkpoint before exploring a dirty input", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const createRoute = (middleY: number): HighDensityRoute => ({
    connectionName: "A",
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: middleY, z: 0 },
      { x: 8, y: middleY, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  const dirtyRoutes = [createRoute(0)]
  const cleanCheckpoint = [createRoute(0.3)]
  const drcEvaluator: DrcEvaluator = ({ routes }) =>
    (routes?.[0]?.route[1]?.y ?? 0) >= 0.2
      ? []
      : [
          {
            type: "pcb_trace_error",
            message: "synthetic dirty input",
            center: { x: 5, y: 0 },
            pcb_trace_id: "A_0",
          },
        ]
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: dirtyRoutes,
    additionalCandidateHdRoutes: [cleanCheckpoint],
    effort: 100,
    drcEvaluator,
    maxIterations: 32,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.getOutput()).toBe(cleanCheckpoint)
  expect(solver.stats.drcBranchPortfolioFinalDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioBranchesAttempted).toBe(0)
  expect(solver.stats.drcBranchPortfolioSelectedBranch).toBe("checkpoint-0")
})

test("uses the stricter validation evaluator to protect the benchmark checkpoint", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const createRoute = (middleY: number): HighDensityRoute => ({
    connectionName: "A",
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: middleY, z: 0 },
      { x: 8, y: middleY, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  const benchmarkCleanInput = [createRoute(0)]
  const geometryOnlyCheckpoint = [createRoute(0.3)]
  const geometryEvaluator: DrcEvaluator = ({ routes }) =>
    (routes?.[0]?.route[1]?.y ?? 0) >= 0.2
      ? []
      : [{ message: "geometry-only error" }]
  const validationDrcEvaluator: DrcEvaluator = ({ routes }) =>
    (routes?.[0]?.route[1]?.y ?? 0) < 0.2
      ? []
      : [{ message: "typed benchmark DRC regression" }]
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: benchmarkCleanInput,
    additionalCandidateHdRoutes: [geometryOnlyCheckpoint],
    effort: 100,
    drcEvaluator: geometryEvaluator,
    validationDrcEvaluator,
    maxIterations: 32,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
    enablePostSolveClearanceRelaxation: false,
  })

  solver.solve()

  expect(solver.getOutput()).toBe(benchmarkCleanInput)
  expect(solver.stats.drcBranchPortfolioFinalDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioBranchesAttempted).toBe(0)
  expect(solver.stats.drcBranchPortfolioSelectedBranch).toBe("input")
})
