import { isTraceObstacleDrcError } from "./solverHelpers"
import type { DrcSnapshot } from "./types"

/** Only exclude routes when every DRC issue identifies all copper owners. */
export const getDrcInvolvedRouteIndexes = (
  snapshot: DrcSnapshot,
): ReadonlySet<number> | undefined => {
  const errors = snapshot.rawErrors ?? snapshot.errors
  if (errors.length !== snapshot.count) return undefined
  const indexes = new Set<number>()
  for (const error of errors.concat(snapshot.errors)) {
    const type = error.type ?? error.error_type
    const primary = error.pcb_trace_id
    const ids = new Set<string>(
      [
        primary,
        ...(Array.isArray(error.pcb_trace_ids) ? error.pcb_trace_ids : []),
      ].filter((id): id is string => typeof id === "string"),
    )
    const viaIds = Array.isArray(error.pcb_via_ids) ? error.pcb_via_ids : []
    const identifiedObstacleContact =
      typeof primary === "string" && isTraceObstacleDrcError(error)
    const identifiedViaPadContact =
      type === "pcb_pad_pad_clearance_error" &&
      viaIds.length === 1 &&
      ids.size === 1
    const identifiedCopperPair =
      (type === "pcb_trace_error" ||
        type === "pcb_via_trace_clearance_error" ||
        type === "pcb_via_clearance_error") &&
      ids.size >= 2
    // Custom evaluators can omit a participant or use another error schema.
    // In that case every route remains eligible for the existing search.
    if (
      !identifiedObstacleContact &&
      !identifiedViaPadContact &&
      !identifiedCopperPair
    )
      return undefined
    for (const id of ids) {
      const index = snapshot.traceRouteIndexById.get(id)
      if (index !== undefined) indexes.add(index)
    }
  }
  return indexes
}
