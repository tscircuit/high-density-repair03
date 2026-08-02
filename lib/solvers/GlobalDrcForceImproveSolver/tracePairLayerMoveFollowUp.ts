import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AutoroutingDrcEngine } from "../../drc"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
  materializeRoutes,
} from "./solverHelpers"
import type { DrcEvaluator, DrcSnapshot } from "./types"

export type TracePairLayerMoveEvaluation = {
  routes: HighDensityRoute[]
  snapshot: DrcSnapshot
  viaIssueCount: number
  evaluationCount: number
  followUpAttemptCount: number
  usedFollowUpRepair: boolean
}

type DrcErrorCenter = { x: number; y: number }

const MAX_TRACE_PAIR_LAYER_MOVE_FOLLOW_UPS = 8

const getDrcErrorCenter = (
  error: Record<string, unknown>,
): DrcErrorCenter | undefined => {
  const center = error.center
  if (
    !center ||
    typeof center !== "object" ||
    !("x" in center) ||
    !("y" in center) ||
    typeof center.x !== "number" ||
    typeof center.y !== "number"
  ) {
    return undefined
  }
  return { x: center.x, y: center.y }
}

const isSameTracePairErrorAtNewLocation = ({
  error,
  targetErrorId,
  targetCenter,
}: {
  error: Record<string, unknown>
  targetErrorId: string
  targetCenter: DrcErrorCenter
}) => {
  if (
    error.type !== "pcb_trace_error" ||
    error.pcb_trace_error_id !== targetErrorId
  ) {
    return false
  }
  const center = getDrcErrorCenter(error)
  return (
    center !== undefined &&
    Math.hypot(center.x - targetCenter.x, center.y - targetCenter.y) > 0.05
  )
}

/**
 * Completes a safe trace-layer candidate when it moves the same exact
 * trace-pair collision to another location. The caller still decides whether
 * the completed transaction improves full-board DRC.
 */
export const evaluateTracePairLayerMoveCandidate = ({
  srj,
  candidateRoutes,
  targetError,
  drcEvaluator,
  connMap,
  autoroutingDrcEngine,
}: {
  srj: SimpleRouteJson
  candidateRoutes: HighDensityRoute[]
  targetError: Record<string, unknown>
  drcEvaluator?: DrcEvaluator
  connMap?: ConnectivityMap
  autoroutingDrcEngine?: AutoroutingDrcEngine
}): TracePairLayerMoveEvaluation => {
  const firstSnapshot = getDrcSnapshot(
    srj,
    candidateRoutes,
    drcEvaluator,
    connMap,
    autoroutingDrcEngine,
  )
  const firstViaIssueCount = getViaDrcIssueCount(firstSnapshot)
  const firstEvaluation: TracePairLayerMoveEvaluation = {
    routes: candidateRoutes,
    snapshot: firstSnapshot,
    viaIssueCount: firstViaIssueCount,
    evaluationCount: 1,
    followUpAttemptCount: 0,
    usedFollowUpRepair: false,
  }
  const targetErrorId = targetError.pcb_trace_error_id
  const targetCenter = getDrcErrorCenter(targetError)
  if (typeof targetErrorId !== "string" || !targetCenter) {
    return firstEvaluation
  }

  let workingRoutes = cloneRoutes(candidateRoutes)
  let workingSnapshot = firstSnapshot
  let bestEvaluation = firstEvaluation
  let followUpAttemptCount = 0

  for (
    let followUpIndex = 0;
    followUpIndex < MAX_TRACE_PAIR_LAYER_MOVE_FOLLOW_UPS;
    followUpIndex += 1
  ) {
    const followUpError = workingSnapshot.errors.find((error) =>
      isSameTracePairErrorAtNewLocation({
        error,
        targetErrorId,
        targetCenter,
      }),
    )
    if (!followUpError) break

    const changed = applyDrcErrorForces(
      srj,
      workingRoutes,
      [followUpError],
      workingSnapshot.traceRouteIndexById,
      1,
      connMap,
    )
    if (!changed) break

    followUpAttemptCount += 1
    workingRoutes = materializeRoutes(workingRoutes)
    workingSnapshot = getDrcSnapshot(
      srj,
      workingRoutes,
      drcEvaluator,
      connMap,
      autoroutingDrcEngine,
    )
    const workingViaIssueCount = getViaDrcIssueCount(workingSnapshot)
    if (
      isBetterDrcSnapshot(
        workingSnapshot,
        workingViaIssueCount,
        bestEvaluation.snapshot.count,
        bestEvaluation.snapshot.issueScore,
        bestEvaluation.viaIssueCount,
      )
    ) {
      bestEvaluation = {
        routes: workingRoutes,
        snapshot: workingSnapshot,
        viaIssueCount: workingViaIssueCount,
        evaluationCount: followUpAttemptCount + 1,
        followUpAttemptCount,
        usedFollowUpRepair: true,
      }
    }
    if (workingSnapshot.count === 0) break
  }

  return {
    ...bestEvaluation,
    evaluationCount: followUpAttemptCount + 1,
    followUpAttemptCount,
  }
}
