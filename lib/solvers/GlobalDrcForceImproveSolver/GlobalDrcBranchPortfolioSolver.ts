import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "../../types/high-density-types"
import { GlobalDrcForceImproveSolver } from "./GlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "./drc-snapshot"
import { applyBroadRepulsionForces } from "./solverHelpers"
import { BROAD_FALLBACK_SMALL_ROUTE_LIMIT } from "./solverConfig"
import type { DrcSnapshot, GlobalDrcBranchPortfolioSolverParams } from "./types"

type PortfolioPhase = "start" | "baseline" | "broad" | "viaInPad" | "done"

const MAX_LARGE_BOARD_VIA_IN_PAD_DRC_ISSUES = 3

export class GlobalDrcBranchPortfolioSolver extends BaseSolver {
  readonly params: GlobalDrcBranchPortfolioSolverParams
  readonly inputHdRoutes: HighDensityRoute[]
  readonly broadMaxIterations: number
  readonly broadPassMultiplier: number
  outputHdRoutes: HighDensityRoute[]
  private phase: PortfolioPhase = "start"
  private inputSnapshot?: DrcSnapshot
  private baselineSolver?: GlobalDrcForceImproveSolver
  private baselineSnapshot?: DrcSnapshot
  private broadInputSnapshot?: DrcSnapshot
  private broadSnapshot?: DrcSnapshot
  private broadSolver?: GlobalDrcForceImproveSolver
  private viaInPadSolver?: GlobalDrcForceImproveSolver
  private portfolioSelectedSolver?: GlobalDrcForceImproveSolver
  private selectedSolver?: GlobalDrcForceImproveSolver

  constructor(params: GlobalDrcBranchPortfolioSolverParams) {
    super()
    if (!Number.isFinite(params.broadPassMultiplier)) {
      throw new Error("broadPassMultiplier must be a finite number")
    }
    if (params.broadPassMultiplier <= 0) {
      throw new Error("broadPassMultiplier must be greater than zero")
    }
    if (!Number.isInteger(params.broadMaxIterations)) {
      throw new Error("broadMaxIterations must be an integer")
    }
    if (params.broadMaxIterations <= 0) {
      throw new Error("broadMaxIterations must be greater than zero")
    }
    if (
      params.viaInPadMaxIterations !== undefined &&
      !Number.isInteger(params.viaInPadMaxIterations)
    ) {
      throw new Error("viaInPadMaxIterations must be an integer")
    }
    if (
      params.viaInPadMaxIterations !== undefined &&
      params.viaInPadMaxIterations <= 0
    ) {
      throw new Error("viaInPadMaxIterations must be greater than zero")
    }
    this.params = params
    this.inputHdRoutes = params.hdRoutes
    this.broadMaxIterations = params.broadMaxIterations
    this.broadPassMultiplier = params.broadPassMultiplier
    this.outputHdRoutes = params.hdRoutes
  }

  override getConstructorParams() {
    return [
      {
        ...this.params,
        hdRoutes: this.inputHdRoutes,
      },
    ] as const
  }

  private stepBranch(solver: GlobalDrcForceImproveSolver, branchName: string) {
    this.activeSubSolver = solver
    solver.step()
    if (solver.failed) {
      throw new Error(`${branchName} DRC repair branch failed: ${solver.error}`)
    }
  }

  private finishWithOutput(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    selectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    this.outputHdRoutes = routes
    this.selectedSolver = selectedSolver
    this.activeSubSolver = null
    this.phase = "done"
    this.progress = 1
    this.stats = {
      ...(this.portfolioSelectedSolver?.stats ?? {}),
      ...(selectedSolver?.stats ?? {}),
      drcBranchPortfolioInitialDrcIssueCount:
        this.inputSnapshot?.count ?? snapshot.count,
      drcBranchPortfolioBaselineDrcIssueCount:
        this.baselineSnapshot?.count ?? snapshot.count,
      drcBranchPortfolioBroadInitialDrcIssueCount:
        this.broadInputSnapshot?.count,
      drcBranchPortfolioBroadFinalDrcIssueCount: this.broadSnapshot?.count,
      drcBranchPortfolioBroadMaxIterations: this.broadMaxIterations,
      drcBranchPortfolioBroadBranchAttempted: Boolean(this.broadSolver),
      drcBranchPortfolioBroadBranchAccepted:
        this.portfolioSelectedSolver !== undefined &&
        this.portfolioSelectedSolver === this.broadSolver,
      drcBranchPortfolioViaInPadPhaseAttempted: Boolean(this.viaInPadSolver),
      drcBranchPortfolioViaInPadMaxIterations:
        this.params.viaInPadMaxIterations,
    }
    this.solved = true
  }

  private startBaselineBranch() {
    this.baselineSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: this.inputHdRoutes,
      enableViaInPadLayerMoves: false,
    })
    this.activeSubSolver = this.baselineSolver
    this.phase = "baseline"
  }

  private startViaInPadPhase(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    portfolioSelectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    this.portfolioSelectedSolver = portfolioSelectedSolver
    if (
      !this.params.enableViaInPadLayerMoves ||
      !this.params.viaInPadDrcEvaluator
    ) {
      this.finishWithOutput(routes, snapshot, portfolioSelectedSolver)
      return
    }
    const viaInPadInputSnapshot = getDrcSnapshot(
      this.params.srj,
      routes,
      this.params.viaInPadDrcEvaluator,
      this.params.connMap,
    )
    if (
      this.inputHdRoutes.length > BROAD_FALLBACK_SMALL_ROUTE_LIMIT &&
      viaInPadInputSnapshot.count > MAX_LARGE_BOARD_VIA_IN_PAD_DRC_ISSUES
    ) {
      this.finishWithOutput(routes, snapshot, portfolioSelectedSolver)
      return
    }

    this.viaInPadSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: routes,
      drcEvaluator: this.params.viaInPadDrcEvaluator,
      maxIterations:
        this.params.viaInPadMaxIterations ?? this.params.maxIterations,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableViaInPadLayerMoves: true,
    })
    this.activeSubSolver = this.viaInPadSolver
    this.phase = "viaInPad"
  }

  private startBroadBranch() {
    const broadInputRoutes = applyBroadRepulsionForces(
      this.params.srj,
      this.inputHdRoutes,
      this.params.effort ?? 1,
      this.broadPassMultiplier,
      this.params.connMap,
    )
    this.broadInputSnapshot = getDrcSnapshot(
      this.params.srj,
      broadInputRoutes,
      this.params.drcEvaluator,
      this.params.connMap,
    )
    if (this.broadInputSnapshot.count >= this.baselineSnapshot!.count) {
      this.startViaInPadPhase(
        this.baselineSolver!.getOutput(),
        this.baselineSnapshot!,
        this.baselineSolver,
      )
      return
    }
    this.broadSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: broadInputRoutes,
      maxIterations: this.broadMaxIterations,
      enableViaInPadLayerMoves: false,
    })
    this.activeSubSolver = this.broadSolver
    this.phase = "broad"
  }

  override _step() {
    if (this.phase === "start") {
      this.inputSnapshot = getDrcSnapshot(
        this.params.srj,
        this.inputHdRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
      )
      if (this.inputSnapshot.count === 0) {
        this.startViaInPadPhase(this.inputHdRoutes, this.inputSnapshot)
        return
      }
      this.startBaselineBranch()
      return
    }

    if (this.phase === "baseline") {
      this.stepBranch(this.baselineSolver!, "baseline")
      if (!this.baselineSolver!.solved) return
      const baselineRoutes = this.baselineSolver!.getOutput()
      this.baselineSnapshot = getDrcSnapshot(
        this.params.srj,
        baselineRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
      )
      if (this.baselineSnapshot.count === 0) {
        this.startViaInPadPhase(
          baselineRoutes,
          this.baselineSnapshot,
          this.baselineSolver,
        )
        return
      }
      this.startBroadBranch()
      return
    }

    if (this.phase === "broad") {
      this.stepBranch(this.broadSolver!, "broad")
      if (!this.broadSolver!.solved) return
      const broadRoutes = this.broadSolver!.getOutput()
      this.broadSnapshot = getDrcSnapshot(
        this.params.srj,
        broadRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
      )
      if (this.broadSnapshot.count < this.baselineSnapshot!.count) {
        this.startViaInPadPhase(
          broadRoutes,
          this.broadSnapshot,
          this.broadSolver,
        )
        return
      }
      this.startViaInPadPhase(
        this.baselineSolver!.getOutput(),
        this.baselineSnapshot!,
        this.baselineSolver,
      )
      return
    }

    if (this.phase === "viaInPad") {
      this.stepBranch(this.viaInPadSolver!, "via-in-pad")
      if (!this.viaInPadSolver!.solved) return
      const viaInPadRoutes = this.viaInPadSolver!.getOutput()
      const viaInPadSnapshot = getDrcSnapshot(
        this.params.srj,
        viaInPadRoutes,
        this.params.viaInPadDrcEvaluator,
        this.params.connMap,
      )
      this.finishWithOutput(
        viaInPadRoutes,
        viaInPadSnapshot,
        this.viaInPadSolver,
      )
    }
  }

  override getOutput() {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    const visualizer = this.activeSubSolver ?? this.selectedSolver
    return visualizer?.visualize() ?? super.visualize()
  }

  override preview(): GraphicsObject {
    const visualizer = this.activeSubSolver ?? this.selectedSolver
    return visualizer?.preview() ?? this.visualize()
  }
}
