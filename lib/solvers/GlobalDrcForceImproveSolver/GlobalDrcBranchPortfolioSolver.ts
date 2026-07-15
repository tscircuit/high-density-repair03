import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "../../types/high-density-types"
import { GlobalDrcForceImproveSolver } from "./GlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "./drc-snapshot"
import { applyBroadRepulsionForces } from "./solverHelpers"
import type { DrcSnapshot, GlobalDrcBranchPortfolioSolverParams } from "./types"

type PortfolioPhase = "start" | "baseline" | "broad" | "done"

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

  private acceptOutput(
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
        selectedSolver !== undefined && selectedSolver === this.broadSolver,
    }
    this.solved = true
  }

  private startBaselineBranch() {
    this.baselineSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: this.inputHdRoutes,
    })
    this.activeSubSolver = this.baselineSolver
    this.phase = "baseline"
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
      this.acceptOutput(
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
        this.acceptOutput(this.inputHdRoutes, this.inputSnapshot)
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
        this.acceptOutput(
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
        this.acceptOutput(broadRoutes, this.broadSnapshot, this.broadSolver)
        return
      }
      this.acceptOutput(
        this.baselineSolver!.getOutput(),
        this.baselineSnapshot!,
        this.baselineSolver,
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
