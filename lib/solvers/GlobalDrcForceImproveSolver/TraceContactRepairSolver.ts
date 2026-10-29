import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "../../types/high-density-types"
import { GlobalDrcBranchPortfolioSolver } from "./GlobalDrcBranchPortfolioSolver"
import { TraceContactGuard } from "./TraceContactGuard"
import { getPeerTraceRepairCandidates } from "./getPeerTraceRepairCandidates"
import { getPeerTraceViaCandidates } from "./getPeerTraceViaCandidates"
import { getDrcSnapshot, hasNewTraceObstacleOverlaps } from "./solverHelpers"
import type { DrcSnapshot, GlobalDrcBranchPortfolioSolverParams } from "./types"

export type TraceContactRepairSolverParams =
  GlobalDrcBranchPortfolioSolverParams & {
    /** Copper before any intermediate stages were allowed to defer their guard. */
    inputHdRoutes: HighDensityRoute[]
  }
type Candidate = { routes: HighDensityRoute[]; snapshot: DrcSnapshot }
type Phase = "start" | "contacts" | "refine" | "vias" | "done"
const isBetter = (candidate: Candidate, previous: Candidate): boolean =>
  candidate.snapshot.count < previous.snapshot.count ||
  (candidate.snapshot.count === previous.snapshot.count &&
    candidate.snapshot.issueScore < previous.snapshot.issueScore - 1e-8)

/** Bounded local repair for a pipeline's final physical trace contacts. */
export class TraceContactRepairSolver extends BaseSolver {
  readonly params: TraceContactRepairSolverParams
  readonly guard: TraceContactGuard
  private phase: Phase = "start"
  private inputSnapshot?: DrcSnapshot
  private targetDrcCount = Infinity
  private current?: Candidate
  private best?: Candidate
  private proposals?: Generator<HighDensityRoute[]>
  private pairs: (readonly [string, string])[] = []
  private affectedConnections = new Set<string>()
  private refineSolver?: GlobalDrcBranchPortfolioSolver
  private candidateChecks = 0
  private geometryChecks = 0
  private contactRounds = 0
  private viaRounds = 0
  private outputHdRoutes: HighDensityRoute[]

  constructor(params: TraceContactRepairSolverParams) {
    super()
    this.params = params
    this.guard = new TraceContactGuard({
      srj: params.srj,
      inputRoutes: params.inputHdRoutes,
      connMap: params.connMap,
    })
    this.outputHdRoutes = params.inputHdRoutes
    this.MAX_ITERATIONS = 20000
  }

  private snapshot(routes: HighDensityRoute[]): DrcSnapshot {
    return getDrcSnapshot(
      this.params.srj,
      routes,
      this.params.drcEvaluator,
      this.params.connMap,
      this.params.autoroutingDrcEngine,
    )
  }

  private startContactRound(): void {
    this.pairs = this.guard.getNewContactPairs(this.current!.routes)
    if (this.pairs.length === 0) {
      this.startRefinement()
      return
    }
    if (
      this.contactRounds++ >= 4 ||
      this.geometryChecks >= 2048 ||
      this.candidateChecks >= 256
    ) {
      this.finish()
      return
    }
    this.best = undefined
    this.proposals = getPeerTraceRepairCandidates({
      ...this.params,
      routes: this.current!.routes,
      pair: this.pairs[0]!,
    })
    this.phase = "contacts"
  }

  private startRefinement(): void {
    if (
      this.current!.snapshot.count <= this.targetDrcCount ||
      hasNewTraceObstacleOverlaps(this.current!.snapshot, this.inputSnapshot!)
    ) {
      this.finish()
      return
    }
    this.refineSolver = new GlobalDrcBranchPortfolioSolver({
      ...this.params,
      hdRoutes: this.current!.routes,
      maxIterations: 4,
      viaInPadMaxIterations: Math.min(
        24,
        this.params.viaInPadMaxIterations ?? 8,
      ),
      broadMaxIterations: 4,
      enableBroadFallback: false,
      enableLargeBoardBroadFallback: false,
      enablePostSolveClearanceRelaxation: false,
      deferTraceContactGuard: false,
      referenceDrcEvaluator: undefined,
    })
    this.activeSubSolver = this.refineSolver
    this.phase = "refine"
  }

  private startViaRound(): void {
    if (
      this.current!.snapshot.count <= this.targetDrcCount ||
      this.viaRounds++ >= 4 ||
      this.candidateChecks >= 768
    ) {
      this.finish()
      return
    }
    this.best = this.current
    this.proposals = getPeerTraceViaCandidates({
      srj: this.params.srj,
      routes: this.current!.routes,
      previousRoutes: this.params.hdRoutes,
      affectedConnections: this.affectedConnections,
    })
    this.phase = "vias"
  }

  private finish(): void {
    const candidate = this.current
    if (
      candidate &&
      candidate.snapshot.count <= this.inputSnapshot!.count &&
      this.guard.getNewContactPairs(candidate.routes).length === 0 &&
      !hasNewTraceObstacleOverlaps(candidate.snapshot, this.inputSnapshot!)
    ) {
      this.outputHdRoutes = candidate.routes
    }
    this.stats = {
      traceContactRepairCandidateChecks: this.candidateChecks,
      traceContactRepairGeometryChecks: this.geometryChecks,
      traceContactRepairContactRounds: this.contactRounds,
      traceContactRepairViaRounds: this.viaRounds,
      traceContactRepairAccepted:
        this.outputHdRoutes !== this.params.inputHdRoutes,
    }
    this.activeSubSolver = null
    this.phase = "done"
    this.progress = 1
    this.solved = true
  }

  override _step(): void {
    if (this.phase === "start") {
      this.inputSnapshot = this.snapshot(this.params.inputHdRoutes)
      this.current = {
        routes: this.params.hdRoutes,
        snapshot: this.snapshot(this.params.hdRoutes),
      }
      // Restore the candidate's DRC quality after removing its physical shorts.
      // Further polishing only spends time once that objective is met.
      this.targetDrcCount = this.current.snapshot.count
      this.affectedConnections = this.guard.getNewContactConnectionNames(
        this.current.routes,
      )
      this.startContactRound()
      return
    }
    if (this.phase === "refine") {
      const solver = this.refineSolver!
      solver.step()
      if (solver.failed)
        throw new Error(`Peer contact refinement failed: ${solver.error}`)
      if (!solver.solved) return
      const routes = solver.getOutput()
      const candidate = { routes, snapshot: this.snapshot(routes) }
      if (
        isBetter(candidate, this.current!) &&
        this.guard.getNewContactPairs(routes).length === 0 &&
        !hasNewTraceObstacleOverlaps(candidate.snapshot, this.inputSnapshot!)
      )
        this.current = candidate
      this.activeSubSolver = null
      this.startViaRound()
      return
    }
    if (this.phase !== "contacts" && this.phase !== "vias") return
    const proposal = this.proposals!.next()
    if (
      proposal.done ||
      this.geometryChecks >= 4096 ||
      this.candidateChecks >= 768
    ) {
      if (this.phase === "contacts") {
        if (!this.best) {
          this.finish()
          return
        }
        this.current = this.best
        this.startContactRound()
      } else if (this.best !== this.current) {
        this.current = this.best
        this.startViaRound()
      } else this.finish()
      return
    }
    const routes = proposal.value
    this.geometryChecks++
    const remainingPairs = this.guard.getNewContactPairs(routes)
    if (this.phase === "contacts") {
      if (
        remainingPairs.length >= this.pairs.length ||
        remainingPairs.some(
          (pair) =>
            (pair[0] === this.pairs[0]![0] && pair[1] === this.pairs[0]![1]) ||
            !this.pairs.some(
              (previous) => previous[0] === pair[0] && previous[1] === pair[1],
            ),
        )
      )
        return
    } else if (remainingPairs.length > 0) return
    this.candidateChecks++
    const candidate = { routes, snapshot: this.snapshot(routes) }
    if (hasNewTraceObstacleOverlaps(candidate.snapshot, this.inputSnapshot!))
      return
    if (!this.best || isBetter(candidate, this.best)) this.best = candidate
  }

  override getOutput(): HighDensityRoute[] {
    return this.outputHdRoutes
  }
}
