import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { GlobalDrcBranchPortfolioSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcBranchPortfolioSolver"
import { GlobalDrcForceImproveSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"
import {
  getDrcSnapshot,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  DrcEvaluator,
  DrcEvaluatorInput,
} from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("a lower DRC count cannot select a new immutable barrel clearance violation", (): void => {
  const fixed = { x: -3.2049095622896213, y: 4.117094184051536 }
  const original = { x: -3.492335283076638, y: 3.8177424594363862 }
  const moved = { x: -3.4373754785171715, y: 3.8502746599778206 }
  const initial: HighDensityRoute[] = [
    {
      connectionName: "moving11",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { ...original, z: 0 },
        { ...original, z: 1 },
      ],
      vias: [original],
    },
    {
      connectionName: "wire1",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "wire2",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 1, y: -1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "wire3",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 2, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const candidate = initial.map(
    (route, index): HighDensityRoute =>
      index === 0
        ? {
            ...route,
            route: [
              { ...moved, z: 0 },
              { ...moved, z: 1 },
            ],
            vias: [moved],
          }
        : {
            ...route,
            route: [
              { x: 0, y: 5 + index, z: 0 },
              { x: 2, y: 5 + index, z: 0 },
            ],
          },
  )
  const fixedTrace: SimplifiedPcbTraces[number] = {
    type: "pcb_trace",
    pcb_trace_id: "fixed28",
    connection_name: "fixed28",
    route: [
      {
        route_type: "via",
        ...fixed,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: initial.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
          pointId: `${route.connectionName}_${index}`,
        }),
      ),
    })),
  }
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })
  let lastInput: DrcEvaluatorInput | undefined
  const evaluator: DrcEvaluator = (input) => {
    lastInput = input
    const { traces, routes } = input
    const route = routes?.find((route) => route.connectionName === "moving11")
    if (!route) throw new Error("Expected the actual movable via owner")
    const via = route.vias[0]!
    const clearance = Math.hypot(via.x - fixed.x, via.y - fixed.y) - 0.3
    return {
      ...engine.evaluate([...traces, fixedTrace]),
      candidateAdmissible: clearance >= 0.1,
    }
  }
  const before = getDrcSnapshot(srj, initial, evaluator)
  const after = getDrcSnapshot(srj, candidate, evaluator)
  expect(
    Math.hypot(original.x - fixed.x, original.y - fixed.y) - 0.3,
  ).toBeCloseTo(0.115, 12)
  expect(Math.hypot(moved.x - fixed.x, moved.y - fixed.y) - 0.3).toBeCloseTo(
    0.0538828346139979,
    12,
  )
  expect(after.count).toBeLessThan(before.count)
  expect(
    after.errors.some((error) => error.type === "pcb_via_clearance_error"),
  ).toBe(true)
  expect(before.candidateAdmissible).toBe(true)
  expect(after.candidateAdmissible).toBe(false)
  expect(isDrcSnapshotCountBetter(after, before)).toBe(false)
  expect(
    isBetterDrcSnapshot(after, 1, before.count, before.issueScore, 0, before),
  ).toBe(false)
  expect(
    isDrcSnapshotCountBetter(
      { ...after, candidateAdmissible: undefined },
      before,
    ),
  ).toBe(true)
  if (!lastInput)
    throw new Error("Expected the real materialized candidate evaluator input")
  const materializedCandidateInput = lastInput
  const portfolio = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: initial,
    drcEvaluator: evaluator,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const legacy = portfolio.legacyDrcEvaluator(materializedCandidateInput)
  if (Array.isArray(legacy))
    throw new Error(
      "Expected typed candidate admission to survive the legacy DRC view",
    )
  expect(legacy.candidateAdmissible).toBe(false)
  const cachedCandidate = evaluator(materializedCandidateInput)
  evaluator.getCachedResult = (input) =>
    input.routes === candidate ? cachedCandidate : undefined
  const referencePortfolio = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: initial,
    drcEvaluator: evaluator,
    referenceDrcEvaluator: evaluator,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const referenceForce = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: initial,
    drcEvaluator: evaluator,
    referenceDrcEvaluator: evaluator,
    maxIterations: 1,
  })
  expect(
    referencePortfolio["getReferenceDrcSnapshot"](candidate)
      .candidateAdmissible,
  ).toBe(false)
  expect(
    referenceForce["getReferenceDrcSnapshot"](candidate).candidateAdmissible,
  ).toBe(false)
})
