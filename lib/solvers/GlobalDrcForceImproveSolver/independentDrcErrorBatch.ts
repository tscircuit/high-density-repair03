import {
  BROAD_FALLBACK_SMALL_ROUTE_LIMIT,
  CLEARANCE_SLACK,
  LARGE_DRC_COUNT_THRESHOLD,
  TRACE_PAD_REPAIR_MAX_MOVE,
} from "./solverConfig"
import {
  getTraceRouteIndexForError,
  getTraceRoutePairForError,
} from "./solverHelpers"

type Point = { x: number; y: number }

type IndependentDrcErrorBatchPolicyInput = {
  routeCount: number
  initialDrcIssueCount: number
  batchSize: number
}

export const shouldTryIndependentDrcErrorBatch = ({
  routeCount,
  initialDrcIssueCount,
  batchSize,
}: IndependentDrcErrorBatchPolicyInput): boolean =>
  routeCount > BROAD_FALLBACK_SMALL_ROUTE_LIMIT &&
  initialDrcIssueCount >= LARGE_DRC_COUNT_THRESHOLD &&
  batchSize >= 2

const getErrorCenter = (
  error: Record<string, unknown>,
): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const maybeCenter = center as Record<string, unknown>
  return typeof maybeCenter.x === "number" && typeof maybeCenter.y === "number"
    ? { x: maybeCenter.x, y: maybeCenter.y }
    : undefined
}

export const getIndependentDrcErrorBatch = (
  errors: Array<Record<string, unknown>>,
  traceRouteIndexById: Map<string, number>,
  startIndex = 0,
): Array<Record<string, unknown>> => {
  if (errors.length < 2) return errors

  const maxBatchSize = Math.max(2, Math.ceil(Math.sqrt(errors.length)))
  const minCenterSeparation =
    TRACE_PAD_REPAIR_MAX_MOVE * 2 + CLEARANCE_SLACK
  const selected: Array<Record<string, unknown>> = []
  const selectedCenters: Point[] = []
  const usedRouteIndexes = new Set<number>()
  const usedViaIds = new Set<string>()

  for (let offset = 0; offset < errors.length; offset += 1) {
    const error = errors[(startIndex + offset) % errors.length]
    if (!error) continue
    const center = getErrorCenter(error)
    if (!center) continue

    const routePair = getTraceRoutePairForError(error, traceRouteIndexById)
    const routeIndex = getTraceRouteIndexForError(error, traceRouteIndexById)
    const routeIndexes =
      routePair ?? (routeIndex === undefined ? [] : [routeIndex])
    const viaIds = Array.isArray(error.pcb_via_ids)
      ? error.pcb_via_ids.filter(
          (viaId): viaId is string => typeof viaId === "string",
        )
      : []
    const sharesMovedFeature =
      routeIndexes.some((index) => usedRouteIndexes.has(index)) ||
      viaIds.some((viaId) => usedViaIds.has(viaId))
    const overlapsInfluenceRegion = selectedCenters.some(
      (selectedCenter) =>
        Math.hypot(
          selectedCenter.x - center.x,
          selectedCenter.y - center.y,
        ) < minCenterSeparation,
    )
    if (sharesMovedFeature || overlapsInfluenceRegion) continue

    selected.push(error)
    selectedCenters.push(center)
    for (const index of routeIndexes) usedRouteIndexes.add(index)
    for (const viaId of viaIds) usedViaIds.add(viaId)
    if (selected.length >= maxBatchSize) break
  }

  return selected
}
