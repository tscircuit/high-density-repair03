import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("rejects DRC-improving moves that violate a hard candidate constraint", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "via_net", pointsToConnect: [] }],
    obstacles: [], layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [{
    connectionName: "via_net", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    if (Math.abs(routes![0]!.route[1]!.x) > 1e-6) return []
    return [{
      type: "pcb_pad_pad_clearance_error", pcb_trace_id: "via_net_0",
      pcb_via_ids: ["via_0"], center: { x: 0.2, y: 0 },
    }]
  }
  for (const Solver of [GlobalDrcForceImproveSolver, GlobalDrcBranchPortfolioSolver]) {
    let rejectedCandidates = 0
    const solver = new Solver({
      srj, hdRoutes, drcEvaluator, viaInPadDrcEvaluator: drcEvaluator,
      // The original via is at the edge of a permitted drill region. Moving
      // it left clears the scored contact but violates this separate geometry.
      isValidCandidate: (routes): boolean => {
        const valid = routes.every((route) => route.vias.every((via) => via.x >= 0))
        if (!valid) rejectedCandidates++
        return valid
      },
      maxIterations: 4, broadMaxIterations: 1, broadPassMultiplier: 1,
      viaInPadMaxIterations: 4, enableBroadFallback: false,
      enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true, enableViaInPadLayerMoves: false,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.getOutput().every((route) => route.vias.every((via) => via.x >= 0))).toBeTrue()
    expect(rejectedCandidates).toBeGreaterThan(0)
  }
})
