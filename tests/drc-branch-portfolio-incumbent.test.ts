import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  AutoroutingDrcEngine,
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
} from "../lib"
import * as helpers from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getUsbCircuitRender } from "./fixtures/getUsbCircuitRender"
import recordedOutputs from "./fixtures/usb-portfolio-branch-outputs.json"

test("keeps an accepted safe-layer candidate when a later broad branch only ties it", async () => {
  const { phases } = await getUsbCircuitRender()
  const repair = phases[2]!.repairs[0]!
  const originalInput = structuredClone(repair.input)
  const connMap = new ConnectivityMap(repair.netMap)
  const engine = new AutoroutingDrcEngine(repair.srj, { connMap })
  const outputs: Record<keyof typeof recordedOutputs, HighDensityRoute[]> =
    recordedOutputs
  const snapshots = {
    baseline: helpers.getDrcSnapshot(
      repair.srj,
      outputs.baseline,
      undefined,
      connMap,
      engine,
    ),
    safe: helpers.getDrcSnapshot(
      repair.srj,
      outputs.safe,
      undefined,
      connMap,
      engine,
    ),
    broad: helpers.getDrcSnapshot(
      repair.srj,
      outputs.broad,
      undefined,
      connMap,
      engine,
    ),
  }
  expect(snapshots.baseline.count).toBe(3)
  expect(snapshots.safe.count).toBe(1)
  expect(snapshots.broad.count).toBe(1)
  expect(
    helpers.isDrcSnapshotCountBetter(snapshots.broad, snapshots.baseline),
  ).toBe(true)
  expect(
    helpers.isDrcSnapshotCountBetter(snapshots.broad, snapshots.safe),
  ).toBe(false)

  // These are unedited outputs from the native USB fixture's CC1 phase:
  // main c149b6d produced the baseline and safe-layer candidates; the actual
  // copper-width fix (3c50d3d, PR #133) produced the broad candidate. Replay
  // candidate generation only, so this independent orchestration regression
  // does not need that separate geometry fix. DRC evaluation stays real.
  const candidates = [
    outputs.baseline,
    outputs.safe,
    outputs.broad,
    outputs.broad,
  ]
  const branches: GlobalDrcForceImproveSolver[] = []
  const seed = spyOn(helpers, "applyBroadRepulsionForces").mockReturnValue(
    outputs.broad,
  )
  const branchStep = spyOn(
    GlobalDrcForceImproveSolver.prototype,
    "step",
  ).mockImplementation(function (this: GlobalDrcForceImproveSolver) {
    const candidate = candidates.shift()
    if (!candidate) throw new Error("Unexpected extra repair branch")
    branches.push(this)
    this.outputHdRoutes = candidate
    this.solved = true
  })
  try {
    const solver = new GlobalDrcBranchPortfolioSolver({
      srj: repair.srj,
      hdRoutes: repair.input,
      connMap,
      autoroutingDrcEngine: engine,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
      maxIterations: 4,
      broadMaxIterations: 4,
      broadPassMultiplier: 3,
    })
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(candidates).toHaveLength(0)
    expect(solver.getOutput()).toEqual(outputs.safe)
    expect(solver.visualize()).toEqual(branches[1]!.visualize())
    expect(repair.input).toEqual(originalInput)
    expect(solver.stats.drcBranchPortfolioBaselineDrcIssueCount).toBe(3)
    expect(solver.stats.drcBranchPortfolioBroadFinalDrcIssueCount).toBe(1)
    expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
    expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted).toBe(
      true,
    )
    expect(solver.stats.finalDrcIssueCount).toBe(1)
    for (const input of repair.input) {
      const output = solver
        .getOutput()
        .find((route) => route.connectionName === input.connectionName)!
      expect(output.route[0]).toEqual(input.route[0])
      expect(output.route.at(-1)).toEqual(input.route.at(-1))
      expect(output.traceThickness).toBe(input.traceThickness)
      expect(output.viaDiameter).toBe(input.viaDiameter)
      for (let index = 1; index < output.route.length; index++) {
        const previous = output.route[index - 1]!
        const current = output.route[index]!
        if (previous.z !== current.z) {
          expect(
            output.vias.some(
              (via) =>
                Math.hypot(previous.x - via.x, previous.y - via.y) <=
                  output.viaDiameter / 2 &&
                Math.hypot(current.x - via.x, current.y - via.y) <=
                  output.viaDiameter / 2,
            ),
          ).toBe(true)
        }
      }
    }
  } finally {
    branchStep.mockRestore()
    seed.mockRestore()
  }
})
