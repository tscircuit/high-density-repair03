import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("rejects a repair candidate that regresses the reference DRC", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "via_net", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "via_net",
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
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const viaX = routes?.[0]?.route[1]?.x ?? 0
    if (Math.abs(viaX) > 1e-6) return []
    return [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_trace_id: "via_net_0",
        pcb_via_ids: ["via_0"],
        center: { x: 0.2, y: 0 },
      },
    ]
  }
  const referenceDrcEvaluator: DrcEvaluator = ({ routes }) => {
    const viaX = routes?.[0]?.route[1]?.x ?? 0
    if (Math.abs(viaX) <= 1e-6) return []
    return [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }]
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    referenceDrcEvaluator,
    viaInPadDrcEvaluator: drcEvaluator,
    maxIterations: 4,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    viaInPadMaxIterations: 4,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  expect(solver.getOutput()[0]?.route[1]?.x).toBe(0)
  expect(solver.stats.globalDrcForceImproveReferenceCandidateRolledBack).toBe(
    true,
  )
  expect(solver.stats.globalDrcForceImproveReferenceInputDrcIssueCount).toBe(0)
  expect(
    solver.stats.globalDrcForceImproveReferenceCandidateDrcIssueCount,
  ).toBe(1)
})
