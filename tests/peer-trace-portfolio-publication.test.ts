import { expect, spyOn, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("the outer portfolio cannot publish a peer short explored by its deferred child", (): void => {
  const input: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 2, y: -1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
      ],
    },
  ]
  const candidate = structuredClone(input)
  candidate[1]!.route[1]!.x = 0
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.2,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: input.map((entry) => ({
      name: entry.connectionName,
      pointsToConnect: [],
    })),
  }
  // Deferred children may explore this state; the parent owns publication.
  const child = spyOn(
    GlobalDrcForceImproveSolver.prototype,
    "_step",
  ).mockImplementation(function (this: GlobalDrcForceImproveSolver): void {
    ;(
      this as unknown as { outputHdRoutes: HighDensityRoute[] }
    ).outputHdRoutes = candidate
    this.solved = true
  })
  try {
    const solver = new GlobalDrcBranchPortfolioSolver({
      srj,
      hdRoutes: input,
      maxIterations: 1,
      broadMaxIterations: 1,
      broadPassMultiplier: 1,
      enableSafeTraceLayerMoves: false,
      enableViaInPadLayerMoves: false,
      enablePostSolveClearanceRelaxation: false,
      drcEvaluator: ({ routes }) =>
        routes?.[1]?.route[1]?.x === 0
          ? []
          : [{ type: "clearance" }, { type: "clearance" }],
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(child).toHaveBeenCalled()
    expect(solver.getOutput()).toEqual(input)
    expect(solver.stats.finalDrcIssueCount).toBe(2)
  } finally {
    child.mockRestore()
  }
})
