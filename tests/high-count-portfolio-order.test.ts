import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("runs broad repair before exhaustive safe-layer search for high DRC counts", () => {
  const collidingRoutes: HighDensityRoute[] = ["A", "B"].map(
    (connectionName, index) => ({
      connectionName,
      route: [
        { x: 1, y: 5 + index * 0.02, z: 0 },
        { x: 3, y: 5 + index * 0.02, z: 0 },
        { x: 7, y: 5 + index * 0.02, z: 0 },
        { x: 9, y: 5 + index * 0.02, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const distantRoutes: HighDensityRoute[] = Array.from(
    { length: 119 },
    (_, index) => ({
      connectionName: `dummy_${index}`,
      route: [
        { x: 1, y: 20 + index * 2, z: 0 },
        { x: 9, y: 20 + index * 2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const hdRoutes = [...collidingRoutes, ...distantRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 260 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const separation = Math.abs(
      (routes?.[0]?.route[1]?.y ?? 0) - (routes?.[1]?.route[1]?.y ?? 0),
    )
    if (separation >= 0.15) return []
    return Array.from({ length: 4 }, (_, index) => ({
      type: "pcb_trace_error",
      message: `externally constrained violation ${index}`,
      pcb_trace_id: `trace_${index}`,
    }))
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 3,
  })

  solver.step()
  const baselineSolver = solver.activeSubSolver
  if (!(baselineSolver instanceof GlobalDrcForceImproveSolver)) {
    throw new Error("Portfolio did not start its baseline repair branch")
  }
  while (solver.activeSubSolver === baselineSolver) solver.step()

  const nextSolver = solver.activeSubSolver
  if (!(nextSolver instanceof GlobalDrcForceImproveSolver)) {
    throw new Error("Portfolio did not start its broad repair branch")
  }
  expect(nextSolver.enableSafeTraceLayerMoves).toBe(false)
})

test("starts broad repair from the baseline output", () => {
  const hdRoutes: HighDensityRoute[] = Array.from(
    { length: 121 },
    (_, index) => ({
      connectionName: `route_${index}`,
      route: [
        { x: 1, y: index, z: 0 },
        { x: 9, y: index, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 122 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const evaluatedRoutes: HighDensityRoute[][] = []
  const drcEvaluator: DrcEvaluator = ({ routes = [] }) => {
    evaluatedRoutes.push(routes)
    return Array.from({ length: 4 }, (_, index) => ({
      type: "pcb_trace_error",
      message: `persistent violation ${index}`,
      pcb_trace_id: `trace_${index}`,
    }))
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 3,
  })

  solver.step()
  const baselineSolver = solver.activeSubSolver as GlobalDrcForceImproveSolver
  baselineSolver.outputHdRoutes = baselineSolver.getOutput().map((route) => ({
    ...route,
    rootConnectionName: "baseline-output",
  }))
  baselineSolver.solved = true
  solver.step()

  expect(evaluatedRoutes.at(-1)?.[0]?.rootConnectionName).toBe(
    "baseline-output",
  )
})

test("does not repeat broad repair after safe-layer repair is accepted", () => {
  const hdRoutes: HighDensityRoute[] = Array.from(
    { length: 121 },
    (_, index) => ({
      connectionName: `route_${index}`,
      route: [
        { x: 1, y: index, z: 0 },
        { x: 9, y: index, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 122 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  let evaluationCount = 0
  const drcEvaluator: DrcEvaluator = ({ routes = [] }) => {
    evaluationCount += 1
    const issueCount =
      routes[0]?.rootConnectionName === "safe-layer-output" ? 3 : 120
    return Array.from({ length: issueCount }, (_, index) => ({
      type: "pcb_trace_error",
      message: `persistent violation ${index}`,
      pcb_trace_id: `trace_${index}`,
    }))
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 3,
  })

  solver.step()
  const baselineSolver = solver.activeSubSolver as GlobalDrcForceImproveSolver
  baselineSolver.solved = true
  solver.step()
  const safeTraceLayerSolver =
    solver.activeSubSolver as GlobalDrcForceImproveSolver
  safeTraceLayerSolver.outputHdRoutes = safeTraceLayerSolver
    .getOutput()
    .map((route) => ({
      ...route,
      rootConnectionName: "safe-layer-output",
    }))
  safeTraceLayerSolver.solved = true
  const evaluationsBeforeSafeResult = evaluationCount
  solver.step()

  expect(solver.solved).toBe(true)
  expect(evaluationCount - evaluationsBeforeSafeResult).toBe(1)
})
