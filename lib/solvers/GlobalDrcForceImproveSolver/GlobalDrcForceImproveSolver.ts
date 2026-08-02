import { BaseSolver } from "../BaseSolver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingDrcEngine } from "../../drc"
import {
  BROAD_FALLBACK_SMALL_ROUTE_LIMIT,
  EXTENDED_BROAD_FORCE_PASS_MULTIPLIER,
  LARGE_DRC_COUNT_THRESHOLD,
  MAX_DRC_COUNT_PLATEAU_CHECKS,
  MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES,
  MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK,
  getBaseMaxIterations,
  getDrcCountImprovementCheckInterval,
  getDrcScaledMaxIterations,
  getForceScalesForEffort,
  getLargeBoardBroadFallbackCadence,
  getMaxTargetedCandidateAttemptsForEffort,
  getRouteComplexityMinIterations,
} from "./solverConfig"
import {
  applyBroadRepulsionForces,
  applyDrcErrorForces,
  applySafeTraceLayerMoveForError,
  applyTerminalViaRelocationForError,
  applyTracePairDetourForError,
  applyTracePairLayerMoveForError,
  applyViaInPadLayerMoveForError,
  cloneRoutes,
  cloneRoutesForIndexes,
  getCenteredErrors,
  getDrcSnapshot,
  getTargetedClearanceSweepErrors,
  getTraceRouteIndexForError,
  getTraceRoutePairForError,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
  materializeRoutes,
  materializeRoutesForIndexes,
  SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT,
} from "./solverHelpers"
import { applyTraceToPadClearanceRelaxation } from "./traceToPadClearanceRelaxation"
import { applyViaToPadClearanceRelaxation } from "./viaToPadClearanceRelaxation"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import {
  applyPadTraceClearanceDetour,
  PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT,
} from "./pad-trace-clearance-detour"
import type {
  DrcEvaluator,
  DrcSnapshot,
  GlobalDrcForceImproveSolverParams,
} from "./types"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type GlobalDrcForceImproveSolverVisualizer = (
  solver: GlobalDrcForceImproveSolver,
) => GraphicsObject

let registeredVisualizer: GlobalDrcForceImproveSolverVisualizer | undefined

export const setGlobalDrcForceImproveSolverVisualizer = (
  visualizer: GlobalDrcForceImproveSolverVisualizer,
) => {
  registeredVisualizer = visualizer
}

const TRACE_PAIR_DETOUR_VARIANTS = ([0, 1] as const).flatMap((routeSide) =>
  ([0, 1] as const).map((blockingEndpointSide) => ({
    routeSide,
    blockingEndpointSide,
  })),
)

const getTraceErrorKey = (error: Record<string, unknown>) =>
  typeof error.pcb_trace_error_id === "string"
    ? error.pcb_trace_error_id
    : typeof error.pcb_trace_id === "string"
      ? error.pcb_trace_id
      : undefined

const getPadTraceErrorKey = (error: Record<string, unknown>) =>
  typeof error.pcb_pad_trace_clearance_error_id === "string"
    ? error.pcb_pad_trace_clearance_error_id
    : typeof error.pcb_pad_id === "string"
      ? getTraceErrorKey(error)
      : undefined

const SAFE_TRACE_LAYER_LOCAL_EXPANSIONS = [0, 1, 2] as const

export class GlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly inputHdRoutes: HighDensityRoute[]
  readonly connMap?: ConnectivityMap
  readonly effort: number
  readonly drcEvaluator?: DrcEvaluator
  readonly autoroutingDrcEngine?: AutoroutingDrcEngine
  readonly viaHoleDiameter?: number
  readonly configuredMaxIterations?: number
  readonly enableLargeBoardBroadFallback: boolean
  readonly enableTargetedErrorSweep: boolean
  readonly enablePostSolveClearanceRelaxation: boolean
  readonly enableSafeTraceLayerMoves: boolean
  readonly enableViaInPadLayerMoves: boolean
  readonly repairMode: "default" | "safe_topology_only"
  outputHdRoutes: HighDensityRoute[]
  private initialDrcIssueCount: number | undefined
  private broadForceAccepted = false
  private targetedForceAccepted = false
  private candidateAttempts = 0
  private viaInPadCandidateAttempts = 0
  private viaInPadCandidatesAccepted = 0
  private padTraceClearanceDetourAttempts = 0
  private tracePairDetourAttempts = 0
  private padTopologyErrorCursor = 0
  private padTraceClearanceDetourCursorByErrorId = new Map<string, number>()
  private safeTopologyVariantsCheckedSinceImprovement = 0
  private safeTraceLayerCursorByErrorId = new Map<string, number>()
  private tracePairDetourCursorByErrorId = new Map<string, number>()
  private errorCursor = 0
  private stalledIterations = 0
  private bestDrcIssueCountSeen: number | undefined
  private bestDrcIssueScoreSeen: number | undefined
  private lastDrcCountImprovementCheckIteration = 0
  private drcCountPlateauChecks = 0
  private largeBoardBroadFallbackMisses = 0
  private outputSnapshot: DrcSnapshot | undefined
  readonly padTraceClearanceCandidateDiagnostics: Array<{
    targetErrorId: string | undefined
    variantIndex: number
    count: number
    issueScore: number
    errors: Array<Record<string, unknown>>
  }> = []
  readonly tracePairDetourCandidateDiagnostics: Array<{
    targetErrorId: string
    routeSide: 0 | 1
    blockingEndpointSide: 0 | 1
    count: number
    issueScore: number
    errorIds: Array<unknown>
  }> = []

  constructor(params: GlobalDrcForceImproveSolverParams) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.connMap = params.connMap
    this.effort = params.effort ?? 1
    this.drcEvaluator = params.drcEvaluator
    this.autoroutingDrcEngine =
      params.autoroutingDrcEngine ??
      (params.drcEvaluator
        ? undefined
        : new AutoroutingDrcEngine(params.srj, {
            connMap: params.connMap,
            traceClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.traceClearance,
            viaClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.viaClearance,
          }))
    if (
      params.viaHoleDiameter !== undefined &&
      (!Number.isFinite(params.viaHoleDiameter) || params.viaHoleDiameter <= 0)
    ) {
      throw new Error("viaHoleDiameter must be a positive finite number")
    }
    this.viaHoleDiameter = params.viaHoleDiameter
    this.configuredMaxIterations = params.maxIterations
    this.enableLargeBoardBroadFallback =
      params.enableLargeBoardBroadFallback ?? true
    this.enableTargetedErrorSweep = params.enableTargetedErrorSweep ?? false
    this.enablePostSolveClearanceRelaxation =
      params.enablePostSolveClearanceRelaxation ?? true
    this.enableSafeTraceLayerMoves = params.enableSafeTraceLayerMoves ?? false
    this.enableViaInPadLayerMoves = params.enableViaInPadLayerMoves ?? false
    this.repairMode = params.repairMode ?? "default"
    this.outputHdRoutes = params.hdRoutes
    this.MAX_ITERATIONS =
      this.configuredMaxIterations ?? getBaseMaxIterations(this.effort)
  }

  override getConstructorParams() {
    return [
      {
        srj: this.srj,
        hdRoutes: this.inputHdRoutes,
        connMap: this.connMap,
        effort: this.effort,
        drcEvaluator: this.drcEvaluator,
        autoroutingDrcEngine: this.autoroutingDrcEngine,
        viaHoleDiameter: this.viaHoleDiameter,
        maxIterations: this.configuredMaxIterations,
        enableLargeBoardBroadFallback: this.enableLargeBoardBroadFallback,
        enableTargetedErrorSweep: this.enableTargetedErrorSweep,
        enablePostSolveClearanceRelaxation:
          this.enablePostSolveClearanceRelaxation,
        enableSafeTraceLayerMoves: this.enableSafeTraceLayerMoves,
        enableViaInPadLayerMoves: this.enableViaInPadLayerMoves,
        repairMode: this.repairMode,
      },
    ] as const
  }

  private updateStats(snapshot: DrcSnapshot) {
    this.stats = {
      initialDrcIssueCount: this.initialDrcIssueCount ?? snapshot.count,
      finalDrcIssueCount: snapshot.count,
      globalDrcForceImproveMaxIterations: this.MAX_ITERATIONS,
      globalDrcForceImproveBroadForceAccepted: this.broadForceAccepted,
      globalDrcForceImproveTargetedForceAccepted: this.targetedForceAccepted,
      globalDrcForceImproveCandidateAttempts: this.candidateAttempts,
      globalDrcForceImproveViaInPadCandidateAttempts:
        this.viaInPadCandidateAttempts,
      globalDrcForceImproveViaInPadCandidatesAccepted:
        this.viaInPadCandidatesAccepted,
      globalDrcForceImprovePadTraceClearanceDetourAttempts:
        this.padTraceClearanceDetourAttempts,
      globalDrcForceImproveTracePairDetourAttempts:
        this.tracePairDetourAttempts,
      globalDrcForceImproveStalledIterations: this.stalledIterations,
      globalDrcForceImproveBestDrcIssueCountSeen:
        this.bestDrcIssueCountSeen ?? snapshot.count,
      globalDrcForceImproveBestDrcIssueScoreSeen:
        this.bestDrcIssueScoreSeen ?? snapshot.issueScore,
      globalDrcForceImproveDrcCountPlateauChecks: this.drcCountPlateauChecks,
      globalDrcForceImproveLargeBoardBroadFallbackMisses:
        this.largeBoardBroadFallbackMisses,
    }
  }

  private increaseMaxIterationsForDrcIssueCount(drcIssueCount: number) {
    if (this.configuredMaxIterations !== undefined) {
      this.MAX_ITERATIONS = this.configuredMaxIterations
      return
    }

    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      getDrcScaledMaxIterations(drcIssueCount, this.effort),
      getRouteComplexityMinIterations(this.inputHdRoutes.length, drcIssueCount),
    )
  }

  private acceptSolvedRoutes(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
  ) {
    const traceRelaxedRoutes = this.enablePostSolveClearanceRelaxation
      ? applyTraceToPadClearanceRelaxation(this.srj, routes, this.connMap)
      : routes
    const relaxedRoutes = this.enablePostSolveClearanceRelaxation
      ? applyViaToPadClearanceRelaxation(
          this.srj,
          traceRelaxedRoutes,
          this.connMap,
        )
      : routes
    const relaxedSnapshot =
      relaxedRoutes === routes
        ? snapshot
        : getDrcSnapshot(
            this.srj,
            relaxedRoutes,
            this.drcEvaluator,
            this.connMap,
            this.autoroutingDrcEngine,
          )

    this.outputHdRoutes = relaxedRoutes
    this.outputSnapshot = relaxedSnapshot
    this.stalledIterations = 0
    this.updateStats(relaxedSnapshot)
    this.solved = true
  }

  private updateDrcCountPlateauState(snapshot: DrcSnapshot) {
    this.bestDrcIssueCountSeen ??= snapshot.count
    this.bestDrcIssueScoreSeen ??= snapshot.issueScore
    const initialDrcIssueCount = this.initialDrcIssueCount ?? snapshot.count
    const isLargeRouteBoard =
      this.inputHdRoutes.length > BROAD_FALLBACK_SMALL_ROUTE_LIMIT &&
      initialDrcIssueCount > 0
    const needsLargeBoardBroadFallbackWindow = isLargeRouteBoard

    if (
      (initialDrcIssueCount >= LARGE_DRC_COUNT_THRESHOLD ||
        needsLargeBoardBroadFallbackWindow) &&
      this.iterations < MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK
    ) {
      if (
        snapshot.count < this.bestDrcIssueCountSeen ||
        (snapshot.count === this.bestDrcIssueCountSeen &&
          snapshot.issueScore < this.bestDrcIssueScoreSeen)
      ) {
        this.bestDrcIssueCountSeen = snapshot.count
        this.bestDrcIssueScoreSeen = snapshot.issueScore
      }
      if (
        isLargeRouteBoard &&
        this.largeBoardBroadFallbackMisses >=
          MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES
      ) {
        this.solved = true
      }
      return
    }

    const improvementCheckInterval =
      getDrcCountImprovementCheckInterval(initialDrcIssueCount)

    if (
      this.iterations - this.lastDrcCountImprovementCheckIteration <
      improvementCheckInterval
    ) {
      return
    }

    this.lastDrcCountImprovementCheckIteration = this.iterations
    if (
      snapshot.count < this.bestDrcIssueCountSeen ||
      (snapshot.count === this.bestDrcIssueCountSeen &&
        snapshot.issueScore < this.bestDrcIssueScoreSeen)
    ) {
      this.bestDrcIssueCountSeen = snapshot.count
      this.bestDrcIssueScoreSeen = snapshot.issueScore
      this.drcCountPlateauChecks = 0
      return
    }

    this.drcCountPlateauChecks += 1
    if (this.drcCountPlateauChecks >= MAX_DRC_COUNT_PLATEAU_CHECKS) {
      this.solved = true
    }
  }

  override _step() {
    let bestRoutes = this.outputHdRoutes
    let bestSnapshot =
      this.outputSnapshot ??
      getDrcSnapshot(
        this.srj,
        bestRoutes,
        this.drcEvaluator,
        this.connMap,
        this.autoroutingDrcEngine,
      )
    if (this.initialDrcIssueCount === undefined) {
      this.initialDrcIssueCount = bestSnapshot.count
      this.bestDrcIssueCountSeen = bestSnapshot.count
      this.bestDrcIssueScoreSeen = bestSnapshot.issueScore
      this.increaseMaxIterationsForDrcIssueCount(bestSnapshot.count)
    }

    if (bestSnapshot.count === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
      return
    }

    let bestIssueCount = bestSnapshot.count
    let bestIssueScore = bestSnapshot.issueScore
    let bestViaIssueCount = getViaDrcIssueCount(bestSnapshot)
    const centeredErrors = getCenteredErrors(bestSnapshot.errors)
    if (centeredErrors.length === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
      return
    }

    const maxCandidateAttemptsThisStep =
      getMaxTargetedCandidateAttemptsForEffort(this.effort)
    let candidateAttemptsThisStep = 0
    let safeTraceLayerCandidateAttemptsThisStep = 0
    let padTraceClearanceDetourAttemptsThisStep = 0
    let safeTopologyVariantsCheckedThisStep = 0
    let acceptedCandidate = false
    let attemptedPeriodicLargeBoardBroadFallback = false
    const maxErrorsThisStep = Math.min(
      centeredErrors.length,
      Math.max(1, Math.ceil(this.effort)),
    )
    const startErrorIndex = this.errorCursor % centeredErrors.length

    const targetedSweepErrors = this.enableTargetedErrorSweep
      ? getTargetedClearanceSweepErrors(centeredErrors, this.effort)
      : []
    const shouldTryTracePairTopology =
      (this.initialDrcIssueCount ?? bestIssueCount) <= 3
    const padTraceErrors = centeredErrors.filter(
      (error) =>
        error.type === "pcb_pad_trace_clearance_error" ||
        ((this.enableSafeTraceLayerMoves ||
          this.repairMode === "safe_topology_only" ||
          shouldTryTracePairTopology) &&
          error.type === "pcb_trace_error"),
    )
    const orderedPadTopologyErrors = padTraceErrors.map(
      (_, offset) =>
        padTraceErrors[
          (this.padTopologyErrorCursor + offset) % padTraceErrors.length
        ]!,
    )
    const eligiblePadTraceClearanceErrorCount = padTraceErrors.filter(
      (error) =>
        getPadTraceErrorKey(error) !== undefined &&
        getTraceRouteIndexForError(error, bestSnapshot.traceRouteIndexById) !==
          undefined,
    ).length
    const eligibleTracePairDetourErrorCount = padTraceErrors.filter(
      (error) =>
        error.type === "pcb_trace_error" &&
        getTraceErrorKey(error) !== undefined &&
        getTraceRoutePairForError(error, bestSnapshot.traceRouteIndexById) !==
          undefined,
    ).length
    for (const error of this.enableSafeTraceLayerMoves ||
    this.enableViaInPadLayerMoves ||
    this.repairMode === "safe_topology_only"
      ? orderedPadTopologyErrors
      : []) {
      const safeTraceLayerBudgetExhausted =
        !this.enableSafeTraceLayerMoves ||
        safeTraceLayerCandidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      const viaInPadBudgetExhausted =
        !this.enableViaInPadLayerMoves ||
        candidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      const padTraceClearanceBudgetExhausted =
        this.repairMode !== "safe_topology_only" ||
        padTraceClearanceDetourAttemptsThisStep >= maxCandidateAttemptsThisStep
      const tracePairDetourBudgetExhausted =
        this.repairMode !== "safe_topology_only" ||
        candidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      if (
        acceptedCandidate ||
        (safeTraceLayerBudgetExhausted &&
          viaInPadBudgetExhausted &&
          padTraceClearanceBudgetExhausted &&
          tracePairDetourBudgetExhausted)
      ) {
        break
      }

      this.padTopologyErrorCursor =
        (padTraceErrors.indexOf(error) + 1) % padTraceErrors.length

      let bestTopologyCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
            viaIssueCount: number
            usesViaInPad: boolean
          }
        | undefined
      const traceErrorKey = getTraceErrorKey(error)
      const padTraceErrorKey = getPadTraceErrorKey(error)
      const traceRouteIndex = getTraceRouteIndexForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
      const traceRoutePair = getTraceRoutePairForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
      if (
        this.repairMode === "safe_topology_only" &&
        traceRouteIndex !== undefined &&
        padTraceErrorKey
      ) {
        let detourCursor =
          this.padTraceClearanceDetourCursorByErrorId.get(padTraceErrorKey) ?? 0
        let variantsChecked = 0
        while (
          padTraceClearanceDetourAttemptsThisStep <
            maxCandidateAttemptsThisStep &&
          variantsChecked < PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT
        ) {
          const variantIndex =
            detourCursor % PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT
          detourCursor =
            (detourCursor + 1) % PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT
          variantsChecked += 1
          safeTopologyVariantsCheckedThisStep += 1
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            traceRouteIndex,
          ])
          const changed = applyPadTraceClearanceDetour({
            srj: this.srj,
            routes: candidateRoutes,
            routeIndex: traceRouteIndex,
            error,
            variantIndex,
          })
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [traceRouteIndex],
          )
          padTraceClearanceDetourAttemptsThisStep += 1
          this.candidateAttempts += 1
          this.padTraceClearanceDetourAttempts += 1
          const candidateSnapshot = getDrcSnapshot(
            this.srj,
            materializedCandidateRoutes,
            this.drcEvaluator,
            this.connMap,
            this.autoroutingDrcEngine,
          )
          const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
          this.padTraceClearanceCandidateDiagnostics.push({
            targetErrorId: padTraceErrorKey,
            variantIndex,
            count: candidateSnapshot.count,
            issueScore: candidateSnapshot.issueScore,
            errors: candidateSnapshot.errors.map((candidateError) => ({
              type: candidateError.type,
              traceId: candidateError.pcb_trace_id,
              padId: candidateError.pcb_pad_id,
              errorId:
                candidateError.pcb_trace_error_id ??
                candidateError.pcb_error_id,
              center: candidateError.center ?? candidateError.pcb_center,
              message: candidateError.message,
            })),
          })
          const comparisonCount =
            bestTopologyCandidate?.snapshot.count ?? bestIssueCount
          const comparisonScore =
            bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
          const comparisonViaIssueCount =
            bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

          if (
            candidateViaIssueCount <= bestViaIssueCount &&
            isBetterDrcSnapshot(
              candidateSnapshot,
              candidateViaIssueCount,
              comparisonCount,
              comparisonScore,
              comparisonViaIssueCount,
            )
          ) {
            bestTopologyCandidate = {
              routes: materializedCandidateRoutes,
              snapshot: candidateSnapshot,
              viaIssueCount: candidateViaIssueCount,
              usesViaInPad: false,
            }
          }
        }
        this.padTraceClearanceDetourCursorByErrorId.set(
          padTraceErrorKey,
          detourCursor,
        )
      }
      if (this.enableSafeTraceLayerMoves && traceRouteIndex !== undefined) {
        const safeRouteIndexes = traceRoutePair ?? [traceRouteIndex]
        const localSpanVariantCount =
          safeRouteIndexes.length *
          this.srj.layerCount *
          SAFE_TRACE_LAYER_LOCAL_EXPANSIONS.length
        const fullSpanVariantCount =
          safeRouteIndexes.length *
          this.srj.layerCount *
          SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT
        const variantCount = localSpanVariantCount + fullSpanVariantCount
        let safeTraceLayerCursor = traceErrorKey
          ? (this.safeTraceLayerCursorByErrorId.get(traceErrorKey) ?? 0)
          : 0
        let variantsChecked = 0
        while (
          safeTraceLayerCandidateAttemptsThisStep <
            maxCandidateAttemptsThisStep &&
          variantsChecked < variantCount
        ) {
          const variantIndex = safeTraceLayerCursor
          safeTraceLayerCursor = (safeTraceLayerCursor + 1) % variantCount
          variantsChecked += 1
          const isLocalSpan = variantIndex < localSpanVariantCount
          const modeVariantIndex = isLocalSpan
            ? variantIndex
            : variantIndex - localSpanVariantCount
          const routeSide = modeVariantIndex % safeRouteIndexes.length
          const layerVariant = Math.floor(
            modeVariantIndex / safeRouteIndexes.length,
          )
          const targetZ = layerVariant % this.srj.layerCount
          const spanExpansion = isLocalSpan
            ? SAFE_TRACE_LAYER_LOCAL_EXPANSIONS[
                Math.floor(layerVariant / this.srj.layerCount) %
                  SAFE_TRACE_LAYER_LOCAL_EXPANSIONS.length
              ]!
            : ("full" as const)
          const directionVariant = isLocalSpan
            ? 0
            : Math.floor(layerVariant / this.srj.layerCount)
          const changedRouteIndex = safeRouteIndexes[routeSide]!
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            changedRouteIndex,
          ])
          const changed = applySafeTraceLayerMoveForError(
            this.srj,
            candidateRoutes,
            error,
            changedRouteIndex,
            targetZ,
            spanExpansion,
            this.connMap,
            directionVariant,
          )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [changedRouteIndex],
          )
          safeTraceLayerCandidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          const candidateSnapshot = getDrcSnapshot(
            this.srj,
            materializedCandidateRoutes,
            this.drcEvaluator,
            this.connMap,
            this.autoroutingDrcEngine,
          )
          const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
          const comparisonCount =
            bestTopologyCandidate?.snapshot.count ?? bestIssueCount
          const comparisonScore =
            bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
          const comparisonViaIssueCount =
            bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

          if (
            candidateViaIssueCount <= bestViaIssueCount &&
            isBetterDrcSnapshot(
              candidateSnapshot,
              candidateViaIssueCount,
              comparisonCount,
              comparisonScore,
              comparisonViaIssueCount,
            )
          ) {
            bestTopologyCandidate = {
              routes: materializedCandidateRoutes,
              snapshot: candidateSnapshot,
              viaIssueCount: candidateViaIssueCount,
              usesViaInPad: false,
            }
          }
        }
        if (traceErrorKey) {
          this.safeTraceLayerCursorByErrorId.set(
            traceErrorKey,
            safeTraceLayerCursor,
          )
        }
      }
      const shouldTryTracePairDetour =
        this.repairMode === "safe_topology_only" ||
        (this.enableViaInPadLayerMoves &&
          shouldTryTracePairTopology &&
          this.iterations % 2 === 0 &&
          bestIssueCount <= 1)
      if (shouldTryTracePairDetour && traceErrorKey && traceRoutePair) {
        let detourCursor =
          this.tracePairDetourCursorByErrorId.get(traceErrorKey) ?? 0
        let detourVariantsChecked = 0
        while (
          candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
          detourVariantsChecked < TRACE_PAIR_DETOUR_VARIANTS.length
        ) {
          const variant =
            TRACE_PAIR_DETOUR_VARIANTS[
              detourCursor % TRACE_PAIR_DETOUR_VARIANTS.length
            ]!
          detourCursor += 1
          detourVariantsChecked += 1
          if (this.repairMode === "safe_topology_only") {
            safeTopologyVariantsCheckedThisStep += 1
          }
          const changedRouteIndex = traceRoutePair[variant.routeSide]
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            changedRouteIndex,
          ])
          const changed = applyTracePairDetourForError(
            this.srj,
            candidateRoutes,
            error,
            bestSnapshot.traceRouteIndexById,
            variant.routeSide,
            variant.blockingEndpointSide,
          )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [changedRouteIndex],
          )
          candidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          this.tracePairDetourAttempts += 1
          const candidateSnapshot = getDrcSnapshot(
            this.srj,
            materializedCandidateRoutes,
            this.drcEvaluator,
            this.connMap,
            this.autoroutingDrcEngine,
          )
          const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
          this.tracePairDetourCandidateDiagnostics.push({
            targetErrorId: traceErrorKey,
            routeSide: variant.routeSide,
            blockingEndpointSide: variant.blockingEndpointSide,
            count: candidateSnapshot.count,
            issueScore: candidateSnapshot.issueScore,
            errorIds: candidateSnapshot.errors.map(
              (candidateError) =>
                candidateError.pcb_trace_error_id ??
                candidateError.pcb_error_id,
            ),
          })
          const comparisonCount =
            bestTopologyCandidate?.snapshot.count ?? bestIssueCount
          if (candidateSnapshot.count < comparisonCount) {
            bestTopologyCandidate = {
              routes: materializedCandidateRoutes,
              snapshot: candidateSnapshot,
              viaIssueCount: candidateViaIssueCount,
              usesViaInPad: false,
            }
          }
        }
        this.tracePairDetourCursorByErrorId.set(traceErrorKey, detourCursor)
      }
      for (const endpointSide of this.enableViaInPadLayerMoves
        ? (["start", "end"] as const)
        : []) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
        if (traceRouteIndex === undefined) break
        const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
          traceRouteIndex,
        ])
        const changed = applyTerminalViaRelocationForError(
          this.srj,
          candidateRoutes,
          error,
          bestSnapshot.traceRouteIndexById,
          endpointSide,
          this.connMap,
          this.viaHoleDiameter,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutesForIndexes(
          candidateRoutes,
          [traceRouteIndex],
        )
        this.viaInPadCandidateAttempts += 1
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
          this.connMap,
          this.autoroutingDrcEngine,
        )
        const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
        const comparisonCount =
          bestTopologyCandidate?.snapshot.count ?? bestIssueCount
        const comparisonScore =
          bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
        const comparisonViaIssueCount =
          bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            comparisonCount,
            comparisonScore,
            comparisonViaIssueCount,
          )
        ) {
          bestTopologyCandidate = {
            routes: materializedCandidateRoutes,
            snapshot: candidateSnapshot,
            viaIssueCount: candidateViaIssueCount,
            usesViaInPad: true,
          }
        }
      }
      const viaInPadLayerCount = this.enableViaInPadLayerMoves
        ? this.srj.layerCount
        : 0
      for (let targetZ = 0; targetZ < viaInPadLayerCount; targetZ += 1) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
        if (traceRouteIndex === undefined) break
        const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
          traceRouteIndex,
        ])
        const changed = applyViaInPadLayerMoveForError(
          this.srj,
          candidateRoutes,
          error,
          bestSnapshot.traceRouteIndexById,
          targetZ,
          this.connMap,
          this.viaHoleDiameter,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutesForIndexes(
          candidateRoutes,
          [traceRouteIndex],
        )
        this.viaInPadCandidateAttempts += 1
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
          this.connMap,
          this.autoroutingDrcEngine,
        )
        const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
        const comparisonCount =
          bestTopologyCandidate?.snapshot.count ?? bestIssueCount
        const comparisonScore =
          bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
        const comparisonViaIssueCount =
          bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            comparisonCount,
            comparisonScore,
            comparisonViaIssueCount,
          )
        ) {
          bestTopologyCandidate = {
            routes: materializedCandidateRoutes,
            snapshot: candidateSnapshot,
            viaIssueCount: candidateViaIssueCount,
            usesViaInPad: true,
          }
        }
      }
      if (
        this.enableViaInPadLayerMoves &&
        shouldTryTracePairTopology &&
        traceRoutePair
      ) {
        const routeSides =
          this.iterations % 2 === 0 ? ([0, 1] as const) : ([1, 0] as const)
        const spanExpansion = this.iterations % 3
        for (const routeSide of routeSides) {
          for (let targetZ = 0; targetZ < this.srj.layerCount; targetZ += 1) {
            if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
            const changedRouteIndex = traceRoutePair[routeSide]
            const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
              changedRouteIndex,
            ])
            const changed = applyTracePairLayerMoveForError(
              this.srj,
              candidateRoutes,
              error,
              bestSnapshot.traceRouteIndexById,
              routeSide,
              targetZ,
              spanExpansion,
              this.connMap,
              this.viaHoleDiameter,
            )
            if (!changed) continue

            const materializedCandidateRoutes = materializeRoutesForIndexes(
              candidateRoutes,
              [changedRouteIndex],
            )
            this.viaInPadCandidateAttempts += 1
            candidateAttemptsThisStep += 1
            this.candidateAttempts += 1
            const candidateSnapshot = getDrcSnapshot(
              this.srj,
              materializedCandidateRoutes,
              this.drcEvaluator,
              this.connMap,
              this.autoroutingDrcEngine,
            )
            const candidateViaIssueCount =
              getViaDrcIssueCount(candidateSnapshot)
            const comparisonCount =
              bestTopologyCandidate?.snapshot.count ?? bestIssueCount
            const comparisonScore =
              bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
            const comparisonViaIssueCount =
              bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

            if (
              isBetterDrcSnapshot(
                candidateSnapshot,
                candidateViaIssueCount,
                comparisonCount,
                comparisonScore,
                comparisonViaIssueCount,
              )
            ) {
              bestTopologyCandidate = {
                routes: materializedCandidateRoutes,
                snapshot: candidateSnapshot,
                viaIssueCount: candidateViaIssueCount,
                usesViaInPad: true,
              }
            }
          }
        }
      }

      if (bestTopologyCandidate) {
        bestRoutes = bestTopologyCandidate.routes
        bestSnapshot = bestTopologyCandidate.snapshot
        bestIssueCount = bestSnapshot.count
        bestIssueScore = bestSnapshot.issueScore
        bestViaIssueCount = bestTopologyCandidate.viaIssueCount
        this.targetedForceAccepted = true
        if (bestTopologyCandidate.usesViaInPad) {
          this.viaInPadCandidatesAccepted += 1
        }
        acceptedCandidate = true
      }
    }

    if (this.repairMode === "safe_topology_only") {
      this.outputHdRoutes = bestRoutes
      this.outputSnapshot = bestSnapshot
      if (acceptedCandidate) {
        this.padTraceClearanceDetourCursorByErrorId.clear()
        this.tracePairDetourCursorByErrorId.clear()
        this.safeTopologyVariantsCheckedSinceImprovement = 0
      } else {
        this.safeTopologyVariantsCheckedSinceImprovement +=
          safeTopologyVariantsCheckedThisStep
      }
      this.updateStats(bestSnapshot)
      const totalVariantCount =
        eligiblePadTraceClearanceErrorCount *
          PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT +
        eligibleTracePairDetourErrorCount * TRACE_PAIR_DETOUR_VARIANTS.length
      const allVariantsChecked =
        totalVariantCount === 0 ||
        this.safeTopologyVariantsCheckedSinceImprovement >= totalVariantCount
      if (bestSnapshot.count === 0 || allVariantsChecked) {
        this.solved = true
        this.progress = 1
      }
      return
    }

    if (!acceptedCandidate && targetedSweepErrors.length >= 2) {
      const candidateRoutes = cloneRoutes(bestRoutes)
      let changed = false
      for (const error of targetedSweepErrors) {
        changed =
          applyDrcErrorForces(
            this.srj,
            candidateRoutes,
            [error],
            bestSnapshot.traceRouteIndexById,
            1,
            this.connMap,
          ) || changed
      }

      if (changed) {
        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
          this.connMap,
          this.autoroutingDrcEngine,
        )
        const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
          )
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = candidateSnapshot.count
          bestIssueScore = candidateSnapshot.issueScore
          bestViaIssueCount = candidateViaIssueCount
          this.targetedForceAccepted = true
          acceptedCandidate = true
          if (candidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
        }
      }
    }

    for (
      let errorOffset = 0;
      errorOffset < maxErrorsThisStep &&
      candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
      !acceptedCandidate;
      errorOffset += 1
    ) {
      const errorIndex = (startErrorIndex + errorOffset) % centeredErrors.length
      const error = centeredErrors[errorIndex]
      if (!error) continue

      this.errorCursor = (errorIndex + 1) % centeredErrors.length

      for (const scale of getForceScalesForEffort(this.effort)) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break

        const candidateRoutes = cloneRoutes(bestRoutes)
        const changed = applyDrcErrorForces(
          this.srj,
          candidateRoutes,
          [error],
          bestSnapshot.traceRouteIndexById,
          scale,
          this.connMap,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
          this.connMap,
          this.autoroutingDrcEngine,
        )
        const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
          )
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = candidateSnapshot.count
          bestIssueScore = candidateSnapshot.issueScore
          bestViaIssueCount = candidateViaIssueCount
          this.targetedForceAccepted = true
          acceptedCandidate = true
          if (candidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
          break
        }
      }

      if (acceptedCandidate) break
    }

    const canAffordBroadFallback =
      bestRoutes.length <= BROAD_FALLBACK_SMALL_ROUTE_LIMIT
    const largeBoardBroadFallbackCadence = getLargeBoardBroadFallbackCadence(
      centeredErrors.length,
    )
    const shouldTryPeriodicLargeBoardBroadFallback =
      this.enableLargeBoardBroadFallback &&
      this.MAX_ITERATIONS >= MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK &&
      !canAffordBroadFallback &&
      this.stalledIterations > 0 &&
      this.stalledIterations % largeBoardBroadFallbackCadence === 0
    if (
      !acceptedCandidate &&
      (canAffordBroadFallback ||
        (this.effort >= 2 && this.stalledIterations >= 2) ||
        shouldTryPeriodicLargeBoardBroadFallback)
    ) {
      attemptedPeriodicLargeBoardBroadFallback =
        shouldTryPeriodicLargeBoardBroadFallback
      for (const passMultiplier of [1, EXTENDED_BROAD_FORCE_PASS_MULTIPLIER]) {
        const broadCandidateRoutes = applyBroadRepulsionForces(
          this.srj,
          bestRoutes,
          this.effort,
          passMultiplier,
          this.connMap,
          this.drcEvaluator === undefined,
        )
        if (broadCandidateRoutes === bestRoutes) continue
        const broadCandidateSnapshot = getDrcSnapshot(
          this.srj,
          broadCandidateRoutes,
          this.drcEvaluator,
          this.connMap,
          this.autoroutingDrcEngine,
        )
        const broadCandidateViaIssueCount = getViaDrcIssueCount(
          broadCandidateSnapshot,
        )
        if (
          !isBetterDrcSnapshot(
            broadCandidateSnapshot,
            broadCandidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
          )
        ) {
          continue
        }

        bestRoutes = broadCandidateRoutes
        bestSnapshot = broadCandidateSnapshot
        bestIssueCount = broadCandidateSnapshot.count
        bestIssueScore = broadCandidateSnapshot.issueScore
        bestViaIssueCount = broadCandidateViaIssueCount
        this.broadForceAccepted = true
        acceptedCandidate = true
        if (broadCandidateSnapshot.count === 0) {
          this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
          return
        }
      }
    }

    if (acceptedCandidate) {
      this.largeBoardBroadFallbackMisses = 0
    } else if (attemptedPeriodicLargeBoardBroadFallback) {
      this.largeBoardBroadFallbackMisses += 1
    }

    this.outputHdRoutes = bestRoutes
    this.outputSnapshot = bestSnapshot
    this.stalledIterations = acceptedCandidate ? 0 : this.stalledIterations + 1
    this.updateDrcCountPlateauState(bestSnapshot)
    this.updateStats(bestSnapshot)
    if (this.solved || bestIssueCount === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
    }
  }

  override tryFinalAcceptance() {
    const snapshot =
      this.outputSnapshot ??
      getDrcSnapshot(
        this.srj,
        this.outputHdRoutes,
        this.drcEvaluator,
        this.connMap,
        this.autoroutingDrcEngine,
      )
    this.acceptSolvedRoutes(this.outputHdRoutes, snapshot)
  }

  override getOutput() {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    return registeredVisualizer?.(this) ?? super.visualize()
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
