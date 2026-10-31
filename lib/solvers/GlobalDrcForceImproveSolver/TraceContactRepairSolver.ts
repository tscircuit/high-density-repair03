import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "../../types/high-density-types"
import { GlobalDrcBranchPortfolioSolver } from "./GlobalDrcBranchPortfolioSolver"
import { TraceContactGuard } from "./TraceContactGuard"
import { getPeerTraceRepairCandidates } from "./getPeerTraceRepairCandidates"
import { getPeerTraceViaCandidates } from "./getPeerTraceViaCandidates"
import { getTraceViaSimplificationCandidates } from "./getTraceViaSimplificationCandidates"
import { getDrcSnapshot, hasNewTraceObstacleOverlaps } from "./solverHelpers"
import { restoreOverlappingConnections } from "./restoreOverlappingConnections"
import type { DrcSnapshot, GlobalDrcBranchPortfolioSolverParams } from "./types"

export type TraceContactRepairSolverParams =
  GlobalDrcBranchPortfolioSolverParams & {
    /** Copper before any intermediate stages were allowed to defer their guard. */
    inputHdRoutes: HighDensityRoute[]
  }
type Candidate = { routes: HighDensityRoute[]; snapshot: DrcSnapshot }
type Phase = "start" | "contacts" | "refine" | "vias" | "simplify" | "done"
const countVias = (routes: HighDensityRoute[]): number =>
  routes.reduce((count, route) => count + route.vias.length, 0)
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
  private candidateContactCheck?: ReturnType<
    TraceContactGuard["prepareCandidateCheck"]
  >
  private pairs: (readonly [string, string])[] = []
  private affectedConnections = new Set<string>()
  private refineSolver?: GlobalDrcBranchPortfolioSolver
  private candidateChecks = 0
  private geometryChecks = 0
  private contactRounds = 0
  private viaRounds = 0
  private simplificationRounds = 0
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
    this.guard.preserveClearedContacts(this.current!.routes)
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
    this.candidateContactCheck = this.guard.prepareCandidateCheck(
      this.current!.routes,
    )
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
      maxIterations: 1,
      viaInPadMaxIterations: Math.min(
        24,
        this.params.viaInPadMaxIterations ?? 8,
      ),
      broadMaxIterations: 4,
      // Refine the selected bridges without another topology search that can
      // recreate a crossing.
      enableSafeTraceLayerMoves: false,
      prioritizeMultipleTraceContactRepair: false,
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
    this.guard.preserveClearedContacts(this.current!.routes)
    if (
      this.current!.snapshot.count <= this.targetDrcCount ||
      this.viaRounds++ >= 4 ||
      this.candidateChecks >= 768
    ) {
      this.finish()
      return
    }
    this.best = this.current
    this.candidateContactCheck = this.guard.prepareCandidateCheck(
      this.current!.routes,
    )
    this.proposals = getPeerTraceViaCandidates({
      srj: this.params.srj,
      routes: this.current!.routes,
      previousRoutes: this.params.hdRoutes,
      affectedConnections: this.affectedConnections,
    })
    this.phase = "vias"
  }

  private finish(): void {
    let candidate = this.current
    // A deferred via contact may have no legal local proposal. Restore its
    // whole connections, then validate the mixed board before publishing it.
    // Preserve independent repairs rather than reverting every connection.
    for (let attempt = 0; candidate && attempt < 2; attempt++) {
      const peerConnectionNames = this.guard.getNewContactConnectionNames(
        candidate.routes,
      )
      if (peerConnectionNames.size === 0) break
      const restored = restoreOverlappingConnections({
        routes: candidate.routes,
        snapshot: candidate.snapshot,
        inputSnapshot: this.inputSnapshot!,
        checkpointRoutes: this.params.inputHdRoutes,
        peerConnectionNames,
      })
      if (!restored) break
      this.candidateChecks++
      candidate = {
        routes: restored.routes,
        snapshot: this.snapshot(restored.routes),
      }
    }
    if (
      candidate &&
      candidate.snapshot.count <= this.inputSnapshot!.count &&
      this.guard.getNewContactPairs(candidate.routes).length === 0 &&
      !hasNewTraceObstacleOverlaps(candidate.snapshot, this.inputSnapshot!)
    ) {
      if (
        this.phase !== "simplify" &&
        countVias(candidate.routes) > countVias(this.params.hdRoutes)
      ) {
        this.current = candidate
        this.startSimplificationRound()
        return
      }
      this.outputHdRoutes = candidate.routes
    }
    this.stats = {
      traceContactRepairCandidateChecks: this.candidateChecks,
      traceContactRepairGeometryChecks: this.geometryChecks,
      traceContactRepairContactRounds: this.contactRounds,
      traceContactRepairViaRounds: this.viaRounds,
      traceContactRepairSimplificationRounds: this.simplificationRounds,
      traceContactRepairAccepted:
        this.outputHdRoutes !== this.params.inputHdRoutes,
    }
    this.activeSubSolver = null
    this.phase = "done"
    this.progress = 1
    this.solved = true
  }

  private startSimplificationRound(): void {
    this.phase = "simplify"
    this.guard.preserveClearedContacts(this.current!.routes)
    if (
      countVias(this.current!.routes) <= countVias(this.params.hdRoutes) ||
      this.simplificationRounds++ >= 4
    ) {
      this.finish()
      return
    }
    this.proposals = getTraceViaSimplificationCandidates(this.current!.routes)
    this.candidateContactCheck = this.guard.prepareCandidateCheck(
      this.current!.routes,
    )
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
    if (this.phase === "simplify") {
      const proposal = this.proposals!.next()
      if (
        proposal.done ||
        this.geometryChecks >= 4096 ||
        this.candidateChecks >= 768
      ) {
        this.finish()
        return
      }
      const routes = proposal.value
      this.geometryChecks++
      if (this.candidateContactCheck!(routes).length > 0) return
      this.candidateChecks++
      const snapshot = this.snapshot(routes)
      if (
        snapshot.count > this.current!.snapshot.count ||
        hasNewTraceObstacleOverlaps(snapshot, this.inputSnapshot!) ||
        countVias(routes) >= countVias(this.current!.routes)
      )
        return
      this.current = { routes, snapshot }
      this.startSimplificationRound()
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
    if (
      this.phase === "contacts" &&
      this.guard.hasContactPair(routes, this.pairs[0]!)
    )
      return
    const remainingPairs = this.candidateContactCheck!(routes)
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
    if (
      this.phase === "contacts" &&
      this.best.snapshot.count <= this.current!.snapshot.count &&
      countVias(this.best.routes) <= countVias(this.current!.routes)
    ) {
      this.current = this.best
      this.startContactRound()
    }
  }

  override getOutput(): HighDensityRoute[] {
    return this.outputHdRoutes
  }
}
