import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { GlobalDrcForceImproveSolver } from "./GlobalDrcForceImproveSolver"
import {
  applyBroadRepulsionForces,
  getDrcSnapshot,
  getViaDrcIssueCount,
} from "./solverHelpers"
import type {
  DrcEvaluator,
  DrcSnapshot,
  GlobalDrcBranchPortfolioSolverParams,
} from "./types"

type PortfolioPhase = "start" | "branch" | "done"

type BranchStrategy = {
  name: string
  broadPassMultiplier?: number
  forceScales?: readonly number[]
  targetedErrorStartOffset: number
  targetedSweepScale?: number
}

type RouteComplexity = {
  viaCount: number
  routePointCount: number
  totalTraceLength: number
}

const QUALITY_EPSILON = 1e-9

const getRouteComplexity = (
  routes: HighDensityRoute[],
  connMap?: ConnectivityMap,
): RouteComplexity => {
  const physicalViaKeys = new Set<string>()
  let routePointCount = 0
  let totalTraceLength = 0

  for (const route of routes) {
    const net =
      connMap?.idToNetMap[route.connectionName] ??
      (route.rootConnectionName
        ? connMap?.idToNetMap[route.rootConnectionName]
        : undefined) ??
      route.rootConnectionName ??
      route.connectionName
    routePointCount += route.route.length
    for (let index = 1; index < route.route.length; index += 1) {
      const previousPoint = route.route[index - 1]!
      const point = route.route[index]!
      if (
        previousPoint.z !== point.z &&
        Math.abs(previousPoint.x - point.x) <= 1e-3 &&
        Math.abs(previousPoint.y - point.y) <= 1e-3
      ) {
        physicalViaKeys.add(
          `${net}:${point.x.toFixed(3)}:${point.y.toFixed(3)}`,
        )
      }
      totalTraceLength += Math.hypot(
        point.x - previousPoint.x,
        point.y - previousPoint.y,
      )
    }
  }

  return {
    viaCount: physicalViaKeys.size,
    routePointCount,
    totalTraceLength,
  }
}

const isBetterCandidate = (
  candidateRoutes: HighDensityRoute[],
  candidateSnapshot: DrcSnapshot,
  bestRoutes: HighDensityRoute[],
  bestSnapshot: DrcSnapshot,
  connMap?: ConnectivityMap,
): boolean => {
  if (candidateSnapshot.count !== bestSnapshot.count) {
    return candidateSnapshot.count < bestSnapshot.count
  }
  if (
    Math.abs(candidateSnapshot.issueScore - bestSnapshot.issueScore) >
    QUALITY_EPSILON
  ) {
    return candidateSnapshot.issueScore < bestSnapshot.issueScore
  }

  const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
  const bestViaIssueCount = getViaDrcIssueCount(bestSnapshot)
  if (candidateViaIssueCount !== bestViaIssueCount) {
    return candidateViaIssueCount < bestViaIssueCount
  }

  const candidateComplexity = getRouteComplexity(candidateRoutes, connMap)
  const bestComplexity = getRouteComplexity(bestRoutes, connMap)
  if (candidateComplexity.viaCount !== bestComplexity.viaCount) {
    return candidateComplexity.viaCount < bestComplexity.viaCount
  }
  if (candidateComplexity.routePointCount !== bestComplexity.routePointCount) {
    return candidateComplexity.routePointCount < bestComplexity.routePointCount
  }

  return (
    candidateComplexity.totalTraceLength <
    bestComplexity.totalTraceLength - QUALITY_EPSILON
  )
}

const getBranchStrategies = (
  effort: number,
  broadPassMultiplier: number,
): BranchStrategy[] => {
  const effortScale = Number.isFinite(effort) ? Math.max(1, effort) : 1
  if (effortScale <= 1) {
    return [
      {
        name: "baseline",
        targetedErrorStartOffset: 0,
      },
      {
        name: "broad",
        broadPassMultiplier,
        targetedErrorStartOffset: 0,
      },
    ]
  }
  const branchLimit = Math.min(8, 2 + Math.ceil(Math.log2(effortScale)))
  const strategies: BranchStrategy[] = [
    {
      name: "baseline",
      targetedErrorStartOffset: 0,
    },
    {
      name: "broad-reverse",
      broadPassMultiplier,
      forceScales: [-1, -1.75, 1],
      targetedErrorStartOffset: 1,
      targetedSweepScale: -1,
    },
    {
      name: "targeted-strong",
      forceScales: [2.5, -2.5, 0.75],
      targetedErrorStartOffset: 2,
      targetedSweepScale: 2.5,
    },
    {
      name: "targeted-reverse",
      forceScales: [-1, 1, 1.75],
      targetedErrorStartOffset: 3,
      targetedSweepScale: -1,
    },
    {
      name: "broad-half",
      broadPassMultiplier: broadPassMultiplier * 0.5,
      forceScales: [0.5, 1.25, -1.5],
      targetedErrorStartOffset: 5,
      targetedSweepScale: 0.5,
    },
    {
      name: "targeted-strong-reverse",
      forceScales: [-2.5, -0.75, 1.5],
      targetedErrorStartOffset: 8,
      targetedSweepScale: -1.5,
    },
    {
      name: "broad-strong",
      broadPassMultiplier: broadPassMultiplier * 1.5,
      forceScales: [1.75, -2.5, 0.5],
      targetedErrorStartOffset: 13,
      targetedSweepScale: 1.75,
    },
    {
      name: "broad-short-reverse",
      broadPassMultiplier: broadPassMultiplier * 0.25,
      forceScales: [-0.5, -1.25, 2.5],
      targetedErrorStartOffset: 21,
      targetedSweepScale: -0.5,
    },
  ]

  return strategies.slice(0, branchLimit)
}

export class GlobalDrcBranchPortfolioSolver extends BaseSolver {
  readonly params: GlobalDrcBranchPortfolioSolverParams
  readonly inputHdRoutes: HighDensityRoute[]
  readonly broadMaxIterations: number
  readonly broadPassMultiplier: number
  readonly branchStrategies: BranchStrategy[]
  readonly maxConsecutiveNonImprovingBranches: number
  readonly validationDrcEvaluator?: DrcEvaluator
  outputHdRoutes: HighDensityRoute[]
  private phase: PortfolioPhase = "start"
  private inputSnapshot?: DrcSnapshot
  private bestSnapshot?: DrcSnapshot
  private baselineSnapshot?: DrcSnapshot
  private broadInputSnapshot?: DrcSnapshot
  private broadSnapshot?: DrcSnapshot
  private activeBranchSolver?: GlobalDrcForceImproveSolver
  private selectedSolver?: GlobalDrcForceImproveSolver
  private selectedBranchName = "input"
  private activeBranchStrategy?: BranchStrategy
  private nextBranchIndex = 0
  private branchesAttempted = 0
  private branchesAccepted = 0
  private consecutiveNonImprovingBranches = 0
  private broadBranchesAttempted = 0

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
    this.validationDrcEvaluator =
      params.validationDrcEvaluator ?? params.drcEvaluator
    this.branchStrategies = getBranchStrategies(
      params.effort ?? 1,
      params.broadPassMultiplier,
    )
    const requestedEffort = params.effort ?? 1
    const effortScale = Number.isFinite(requestedEffort)
      ? Math.max(1, requestedEffort)
      : 1
    this.maxConsecutiveNonImprovingBranches = Math.min(
      4,
      2 + Math.floor(Math.log10(effortScale)),
    )
    this.outputHdRoutes = params.hdRoutes
  }

  override getConstructorParams() {
    return [
      {
        ...this.params,
        hdRoutes: this.inputHdRoutes,
        additionalCandidateHdRoutes: this.params.additionalCandidateHdRoutes,
      },
    ] as const
  }

  private finishPortfolio(): void {
    this.activeSubSolver = null
    this.activeBranchSolver = undefined
    this.activeBranchStrategy = undefined
    this.phase = "done"
    this.progress = 1
    this.stats = {
      ...(this.selectedSolver?.stats ?? {}),
      drcBranchPortfolioInitialDrcIssueCount:
        this.inputSnapshot?.count ?? this.bestSnapshot?.count ?? 0,
      drcBranchPortfolioBaselineDrcIssueCount:
        this.baselineSnapshot?.count ?? this.bestSnapshot?.count ?? 0,
      drcBranchPortfolioBroadInitialDrcIssueCount:
        this.broadInputSnapshot?.count,
      drcBranchPortfolioBroadFinalDrcIssueCount: this.broadSnapshot?.count,
      drcBranchPortfolioFinalDrcIssueCount: this.bestSnapshot?.count ?? 0,
      drcBranchPortfolioBroadMaxIterations: this.broadMaxIterations,
      drcBranchPortfolioBranchLimit: this.branchStrategies.length,
      drcBranchPortfolioBranchesAttempted: this.branchesAttempted,
      drcBranchPortfolioBranchesAccepted: this.branchesAccepted,
      drcBranchPortfolioConsecutiveNonImprovingBranches:
        this.consecutiveNonImprovingBranches,
      drcBranchPortfolioStoppedAfterNoImprovement:
        this.consecutiveNonImprovingBranches >=
        this.maxConsecutiveNonImprovingBranches,
      drcBranchPortfolioSelectedBranch: this.selectedBranchName,
      drcBranchPortfolioBroadBranchAttempted: this.broadBranchesAttempted > 0,
      drcBranchPortfolioBroadBranchAccepted:
        this.selectedBranchName.startsWith("broad"),
    }
    this.solved = true
  }

  private initializeCheckpoints(): void {
    this.inputSnapshot = getDrcSnapshot(
      this.params.srj,
      this.inputHdRoutes,
      this.validationDrcEvaluator,
      this.params.connMap,
    )
    this.bestSnapshot = this.inputSnapshot

    const candidates = this.params.additionalCandidateHdRoutes ?? []
    for (let index = 0; index < candidates.length; index += 1) {
      const candidateRoutes = candidates[index]!
      const candidateSnapshot = getDrcSnapshot(
        this.params.srj,
        candidateRoutes,
        this.validationDrcEvaluator,
        this.params.connMap,
      )
      if (
        isBetterCandidate(
          candidateRoutes,
          candidateSnapshot,
          this.outputHdRoutes,
          this.bestSnapshot,
          this.params.connMap,
        )
      ) {
        this.outputHdRoutes = candidateRoutes
        this.bestSnapshot = candidateSnapshot
        this.selectedBranchName = `checkpoint-${index}`
      }
    }
  }

  private startNextBranch(): void {
    const strategy = this.branchStrategies[this.nextBranchIndex]
    if (!strategy) {
      this.finishPortfolio()
      return
    }

    let branchInputRoutes = this.outputHdRoutes
    if (strategy.broadPassMultiplier !== undefined) {
      branchInputRoutes = applyBroadRepulsionForces(
        this.params.srj,
        this.outputHdRoutes,
        this.params.effort ?? 1,
        strategy.broadPassMultiplier,
        this.params.connMap,
      )
      const branchInputSnapshot = getDrcSnapshot(
        this.params.srj,
        branchInputRoutes,
        this.validationDrcEvaluator,
        this.params.connMap,
      )
      this.broadInputSnapshot ??= branchInputSnapshot
      if (
        strategy.name === "broad" &&
        branchInputSnapshot.count >= this.bestSnapshot!.count
      ) {
        this.finishPortfolio()
        return
      }
      this.broadBranchesAttempted += 1
    }

    const {
      additionalCandidateHdRoutes: _additionalCandidateHdRoutes,
      validationDrcEvaluator: _validationDrcEvaluator,
      broadMaxIterations: _broadMaxIterations,
      broadPassMultiplier: _broadPassMultiplier,
      ...solverParams
    } = this.params
    this.activeBranchStrategy = strategy
    this.activeBranchSolver = new GlobalDrcForceImproveSolver({
      ...solverParams,
      hdRoutes: branchInputRoutes,
      maxIterations:
        strategy.broadPassMultiplier === undefined
          ? this.params.maxIterations
          : this.broadMaxIterations,
      forceScales: strategy.forceScales ?? this.params.forceScales,
      targetedErrorStartOffset: strategy.targetedErrorStartOffset,
      targetedSweepScale:
        strategy.targetedSweepScale ?? this.params.targetedSweepScale,
    })
    this.activeSubSolver = this.activeBranchSolver
    this.nextBranchIndex += 1
    this.branchesAttempted += 1
    this.phase = "branch"
    this.progress = this.nextBranchIndex / (this.branchStrategies.length + 1)
  }

  private finishActiveBranch(): void {
    const solver = this.activeBranchSolver!
    const strategy = this.activeBranchStrategy!
    const routes = solver.getOutput()
    const snapshot = getDrcSnapshot(
      this.params.srj,
      routes,
      this.validationDrcEvaluator,
      this.params.connMap,
    )
    if (strategy.name === "baseline") {
      this.baselineSnapshot = snapshot
    } else if (
      strategy.broadPassMultiplier !== undefined &&
      this.broadSnapshot === undefined
    ) {
      this.broadSnapshot = snapshot
    }

    if (
      isBetterCandidate(
        routes,
        snapshot,
        this.outputHdRoutes,
        this.bestSnapshot!,
        this.params.connMap,
      )
    ) {
      this.outputHdRoutes = routes
      this.bestSnapshot = snapshot
      this.selectedSolver = solver
      this.selectedBranchName = strategy.name
      this.branchesAccepted += 1
      this.consecutiveNonImprovingBranches = 0
    } else if (strategy.name !== "baseline") {
      this.consecutiveNonImprovingBranches += 1
    }

    this.activeSubSolver = null
    this.activeBranchSolver = undefined
    this.activeBranchStrategy = undefined
    if (
      this.bestSnapshot!.count === 0 ||
      this.nextBranchIndex >= this.branchStrategies.length ||
      this.consecutiveNonImprovingBranches >=
        this.maxConsecutiveNonImprovingBranches
    ) {
      this.finishPortfolio()
      return
    }
    this.startNextBranch()
  }

  override _step(): void {
    if (this.phase === "start") {
      this.initializeCheckpoints()
      if (this.bestSnapshot!.count === 0) {
        this.finishPortfolio()
        return
      }
      this.startNextBranch()
      return
    }

    if (this.phase !== "branch") return
    this.activeBranchSolver!.step()
    if (this.activeBranchSolver!.failed) {
      throw new Error(
        `${this.activeBranchStrategy!.name} DRC repair branch failed: ${this.activeBranchSolver!.error}`,
      )
    }
    if (this.activeBranchSolver!.solved) {
      this.finishActiveBranch()
    }
  }

  override getOutput(): HighDensityRoute[] {
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
