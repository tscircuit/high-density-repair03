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
  applyTraceDetourForError,
  applyTraceSpanDetourForError,
  applyTraceWaypointDetourForError,
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
  isTraceObstacleDrcError,
  isBetterDrcSnapshot,
  materializeRoutes,
  materializeRoutesForIndexes,
  SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT,
} from "./solverHelpers"
import { applyTraceToPadClearanceRelaxation } from "./traceToPadClearanceRelaxation"
import { applyViaToPadClearanceRelaxation } from "./viaToPadClearanceRelaxation"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
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

const TRACE_PAIR_DETOUR_GEOMETRY_VARIANTS = [0.2, 0.4, 0.8, 1.2].flatMap(
  (halfSpan) =>
    [0.2, 0.3, 0.45, 0.6].flatMap((offset) =>
      ([-1, 1] as const).map((directionSign) => ({
        halfSpan,
        offset,
        directionSign,
      })),
    ),
)

const TRACE_PAIR_DETOUR_VARIANTS = TRACE_PAIR_DETOUR_GEOMETRY_VARIANTS.flatMap(
  (variant) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "segment" as const,
      routeSide,
      ...variant,
    })),
)

const LOW_COUNT_TRACE_TOPOLOGY_VARIANTS = [
  ...([-1, 1] as const).flatMap((directionSign) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "segment" as const,
      routeSide,
      halfSpan: 0.4,
      offset: 1.2,
      directionSign,
    })),
  ),
  ...([-1, 1] as const).flatMap((directionSign) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "span" as const,
      routeSide,
      spanExpansion: 3,
      offset: 1.8,
      directionSign,
    })),
  ),
  ...[
    { dx: -2.4, dy: -0.4 },
    { dx: -2.4, dy: 0.4 },
    { dx: 2.4, dy: -0.4 },
    { dx: 2.4, dy: 0.4 },
    { dx: -0.4, dy: -2.4 },
    { dx: -0.4, dy: 2.4 },
    { dx: 0.4, dy: -2.4 },
    { dx: 0.4, dy: 2.4 },
  ].flatMap((offset) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "waypoint" as const,
      routeSide,
      spanExpansion: 2,
      ...offset,
    })),
  ),
  ...[
    { dx: -0.17, dy: 0 },
    { dx: 0.17, dy: 0 },
    { dx: 0, dy: -0.17 },
    { dx: 0, dy: 0.17 },
  ].flatMap((offset) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "waypoint" as const,
      routeSide,
      spanExpansion: 0,
      ...offset,
    })),
  ),
  ...TRACE_PAIR_DETOUR_VARIANTS,
]

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
  outputHdRoutes: HighDensityRoute[]
  private initialDrcIssueCount: number | undefined
  private initialLowCountErrorsAreTracePairs = false
  private broadForceAccepted = false
  private targetedForceAccepted = false
  private candidateAttempts = 0
  private viaInPadCandidateAttempts = 0
  private viaInPadCandidatesAccepted = 0
  private padTopologyErrorCursor = 0
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

  private getSnapshot(routes: HighDensityRoute[]) {
    return getDrcSnapshot(
      this.srj,
      routes,
      this.drcEvaluator,
      this.connMap,
      this.autoroutingDrcEngine,
      this.initialLowCountErrorsAreTracePairs,
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
      relaxedRoutes === routes ? snapshot : this.getSnapshot(relaxedRoutes)

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
    let bestSnapshot = this.outputSnapshot ?? this.getSnapshot(bestRoutes)
    if (this.initialDrcIssueCount === undefined) {
      this.initialDrcIssueCount = bestSnapshot.count
      this.initialLowCountErrorsAreTracePairs =
        bestSnapshot.count > 1 &&
        bestSnapshot.count <= 3 &&
        bestSnapshot.errors.every(
          (error) =>
            getTraceRoutePairForError(
              error,
              bestSnapshot.traceRouteIndexById,
            ) !== undefined,
        )
      if (this.initialLowCountErrorsAreTracePairs) {
        bestSnapshot = this.getSnapshot(bestRoutes)
      }
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
    let tracePairDetourAttemptedThisStep = false
    let acceptedCandidate = false
    let attemptedPeriodicLargeBoardBroadFallback = false
    const sameNetViaError = this.enableTargetedErrorSweep
      ? centeredErrors.find(
          (error) =>
            error.type === "pcb_via_clearance_error" &&
            error.pcb_via_pair_net_relation === "same_net",
        )
      : undefined
    const prioritizedErrors = sameNetViaError
      ? [
          sameNetViaError,
          ...centeredErrors.filter((error) => error !== sameNetViaError),
        ]
      : centeredErrors
    const maxErrorsThisStep = Math.min(
      prioritizedErrors.length,
      Math.max(1, Math.ceil(this.effort)),
    )
    const startErrorIndex = sameNetViaError
      ? 0
      : this.errorCursor % prioritizedErrors.length

    const targetedSweepErrors = this.enableTargetedErrorSweep
      ? getTargetedClearanceSweepErrors(centeredErrors, this.effort)
      : []
    const shouldTryTracePairTopology =
      bestIssueCount <= 1 || this.initialLowCountErrorsAreTracePairs
    const padTraceErrors = sameNetViaError
      ? []
      : centeredErrors.filter(
          (error) =>
            error.type === "pcb_pad_trace_clearance_error" ||
            ((this.enableSafeTraceLayerMoves || shouldTryTracePairTopology) &&
              error.type === "pcb_trace_error"),
        )
    const orderedPadTopologyErrors = padTraceErrors.map(
      (_, offset) =>
        padTraceErrors[
          (this.padTopologyErrorCursor + offset) % padTraceErrors.length
        ]!,
    )
    for (const error of this.enableSafeTraceLayerMoves ||
    this.enableViaInPadLayerMoves
      ? orderedPadTopologyErrors
      : []) {
      const safeTraceLayerBudgetExhausted =
        !this.enableSafeTraceLayerMoves ||
        safeTraceLayerCandidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      const viaInPadBudgetExhausted =
        !this.enableViaInPadLayerMoves ||
        candidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      if (
        acceptedCandidate ||
        (safeTraceLayerBudgetExhausted && viaInPadBudgetExhausted)
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
      const traceErrorKey =
        typeof error.pcb_trace_error_id === "string"
          ? error.pcb_trace_error_id
          : typeof error.pcb_trace_id === "string"
            ? error.pcb_trace_id
            : undefined
      const traceRouteIndex = getTraceRouteIndexForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
      const traceRoutePair = getTraceRoutePairForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
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
        const prioritizeFullSpan = isTraceObstacleDrcError(error)
        const fullSpanVariantOffset = prioritizeFullSpan
          ? 0
          : localSpanVariantCount
        const localSpanVariantOffset = prioritizeFullSpan
          ? fullSpanVariantCount
          : 0
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
          const isFullSpan =
            variantIndex >= fullSpanVariantOffset &&
            variantIndex < fullSpanVariantOffset + fullSpanVariantCount
          const modeVariantIndex =
            variantIndex -
            (isFullSpan ? fullSpanVariantOffset : localSpanVariantOffset)
          const routeSide = modeVariantIndex % safeRouteIndexes.length
          const layerVariant = Math.floor(
            modeVariantIndex / safeRouteIndexes.length,
          )
          const targetZ = layerVariant % this.srj.layerCount
          const spanExpansion = isFullSpan
            ? ("full" as const)
            : SAFE_TRACE_LAYER_LOCAL_EXPANSIONS[
                Math.floor(layerVariant / this.srj.layerCount) %
                  SAFE_TRACE_LAYER_LOCAL_EXPANSIONS.length
              ]!
          const directionVariant = isFullSpan
            ? Math.floor(layerVariant / this.srj.layerCount)
            : 0
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
          const candidateSnapshot = this.getSnapshot(
            materializedCandidateRoutes,
          )
          const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
          const comparisonCount =
            bestTopologyCandidate?.snapshot.count ?? bestIssueCount

          if (
            candidateViaIssueCount <= bestViaIssueCount &&
            candidateSnapshot.count < comparisonCount
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
      if (
        this.enableSafeTraceLayerMoves &&
        shouldTryTracePairTopology &&
        traceErrorKey &&
        ((this.initialLowCountErrorsAreTracePairs &&
          (traceRoutePair || traceRouteIndex !== undefined)) ||
          (!this.initialLowCountErrorsAreTracePairs && traceRoutePair))
      ) {
        const traceTopologyVariants = this.initialLowCountErrorsAreTracePairs
          ? LOW_COUNT_TRACE_TOPOLOGY_VARIANTS
          : TRACE_PAIR_DETOUR_VARIANTS
        const detourRouteIndexes = traceRoutePair ?? [traceRouteIndex!]
        let detourCursor =
          this.tracePairDetourCursorByErrorId.get(traceErrorKey) ?? 0
        let detourVariantsChecked = 0
        while (
          candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
          detourVariantsChecked < traceTopologyVariants.length
        ) {
          const variant =
            traceTopologyVariants[detourCursor % traceTopologyVariants.length]!
          detourCursor += 1
          detourVariantsChecked += 1
          const changedRouteIndex = detourRouteIndexes[variant.routeSide]
          if (changedRouteIndex === undefined) continue
          const topologyError =
            this.initialLowCountErrorsAreTracePairs &&
            error.worst_contact_center
              ? {
                  ...error,
                  center: error.worst_contact_center,
                  message: error.worst_contact_message ?? error.message,
                  actual_clearance:
                    error.worst_actual_clearance ?? error.actual_clearance,
                }
              : error
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            changedRouteIndex,
          ])
          const changed =
            variant.kind === "segment"
              ? applyTraceDetourForError(
                  candidateRoutes,
                  topologyError,
                  changedRouteIndex,
                  variant.halfSpan,
                  variant.offset,
                  variant.directionSign,
                )
              : variant.kind === "span"
                ? applyTraceSpanDetourForError(
                    this.srj,
                    candidateRoutes,
                    topologyError,
                    changedRouteIndex,
                    variant.spanExpansion,
                    variant.offset,
                    variant.directionSign,
                  )
                : applyTraceWaypointDetourForError(
                    this.srj,
                    candidateRoutes,
                    topologyError,
                    changedRouteIndex,
                    variant.spanExpansion,
                    {
                      x:
                        (topologyError.center as { x: number; y: number }).x +
                        variant.dx,
                      y:
                        (topologyError.center as { x: number; y: number }).y +
                        variant.dy,
                    },
                  )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [changedRouteIndex],
          )
          tracePairDetourAttemptedThisStep = true
          candidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          const candidateSnapshot = this.getSnapshot(
            materializedCandidateRoutes,
          )
          const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)
          const comparisonCount =
            bestTopologyCandidate?.snapshot.count ?? bestIssueCount
          const comparisonScore =
            bestTopologyCandidate?.snapshot.issueScore ?? bestIssueScore
          const comparisonViaIssueCount =
            bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount
          const isBetterTopologyCandidate = this
            .initialLowCountErrorsAreTracePairs
            ? isBetterDrcSnapshot(
                candidateSnapshot,
                candidateViaIssueCount,
                comparisonCount,
                comparisonScore,
                comparisonViaIssueCount,
              )
            : candidateViaIssueCount <= comparisonViaIssueCount &&
              candidateSnapshot.count < comparisonCount
          if (isBetterTopologyCandidate) {
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
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
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
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
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
            const candidateSnapshot = this.getSnapshot(
              materializedCandidateRoutes,
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
            true,
            this.enableTargetedErrorSweep,
            false,
          ) || changed
      }

      if (changed) {
        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
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
      const errorIndex =
        (startErrorIndex + errorOffset) % prioritizedErrors.length
      const error = prioritizedErrors[errorIndex]
      if (!error) continue

      this.errorCursor = (errorIndex + 1) % prioritizedErrors.length
      const canMoveSharedViaSiteWithoutTradingDrcErrors = bestIssueCount === 1

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
          true,
          this.enableTargetedErrorSweep,
          canMoveSharedViaSiteWithoutTradingDrcErrors,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
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
        const broadCandidateSnapshot = this.getSnapshot(broadCandidateRoutes)
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
    if (!tracePairDetourAttemptedThisStep) {
      this.updateDrcCountPlateauState(bestSnapshot)
    }
    this.updateStats(bestSnapshot)
    if (this.solved || bestIssueCount === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
    }
  }

  override tryFinalAcceptance() {
    const snapshot =
      this.outputSnapshot ?? this.getSnapshot(this.outputHdRoutes)
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
