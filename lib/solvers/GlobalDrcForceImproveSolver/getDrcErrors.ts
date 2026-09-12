import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkViaPadClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import type { Point } from "graphics-debug"

type CircuitJson = Parameters<typeof checkEachPcbTraceNonOverlapping>[0]
type CircuitJsonElement = CircuitJson[number]

type TraceError = ReturnType<typeof checkEachPcbTraceNonOverlapping>[number]
type SameNetViaError = ReturnType<typeof checkSameNetViaSpacing>[number]
type DifferentNetViaError = ReturnType<
  typeof checkDifferentNetViaSpacing
>[number]
type ViaError = SameNetViaError | DifferentNetViaError

type DrcError =
  | TraceError
  | ViaError
  | ReturnType<typeof checkPadTraceClearance>[number]
  | ReturnType<typeof checkViaTraceClearance>[number]
  | ReturnType<typeof checkViaPadClearance>[number]

type DrcErrorWithCenter = DrcError & { center?: Point }

type LocationAwareDrcError = DrcError & { center: Point }

export const MIN_VIA_TO_VIA_CLEARANCE = 0.1
export const PREFERRED_VIA_TO_VIA_CLEARANCE = 0.2

export interface GetDrcErrorsResult {
  errors: DrcError[]
  errorsWithCenters: DrcErrorWithCenter[]
  locationAwareErrors: LocationAwareDrcError[]
}

export interface GetDrcErrorsOptions {
  viaClearance?: number
  traceClearance?: number
}

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult => {
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  connMap.addConnections(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" && element.pcb_trace_id
        ? [[element.pcb_via_id, element.pcb_trace_id]]
        : [],
    ),
  )
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
    connMap,
    minClearance: options.traceClearance,
  })
  const viaErrors = [
    ...checkSameNetViaSpacing(circuitJson, {
      connMap,
      minClearance: options.viaClearance,
    }),
    ...checkDifferentNetViaSpacing(circuitJson, {
      connMap,
      minClearance: options.viaClearance,
    }),
  ]

  const errors: DrcError[] = [
    ...traceErrors,
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkViaTraceClearance(circuitJson, {
      connMap,
      minClearance: options.traceClearance,
    }),
    ...checkPadTraceClearance(circuitJson, {
      connMap,
      minClearance: options.traceClearance,
    }),
    ...checkViaPadClearance(circuitJson, { connMap }),
    ...viaErrors,
  ]

  const vias = circuitJson.filter(
    (
      element,
    ): element is CircuitJsonElement & {
      type: "pcb_via"
      pcb_via_id: string
      x: number
      y: number
    } => element.type === "pcb_via",
  )

  const viasById = new Map(vias.map((via) => [via.pcb_via_id, via]))

  const errorsWithCenters = errors.map((error) => {
    // Preserve physical owner identities so typed clearance errors can be repaired.
    const viaIds =
      "pcb_via_id" in error && typeof error.pcb_via_id === "string"
        ? [error.pcb_via_id]
        : "pcb_pad_ids" in error && Array.isArray(error.pcb_pad_ids)
          ? error.pcb_pad_ids.filter((id) => viasById.has(id))
          : []
    if (viaIds.length > 0) {
      const owners = viaIds.flatMap((id) => {
        const via = viasById.get(id)
        return via &&
          "pcb_trace_id" in via &&
          typeof via.pcb_trace_id === "string"
          ? [via.pcb_trace_id]
          : []
      })
      const traceIds =
        "pcb_trace_id" in error && typeof error.pcb_trace_id === "string"
          ? [error.pcb_trace_id]
          : "pcb_trace_ids" in error && Array.isArray(error.pcb_trace_ids)
            ? error.pcb_trace_ids
            : []
      const via = viasById.get(viaIds[0]!)
      return {
        ...error,
        pcb_via_ids: viaIds,
        pcb_trace_ids: [...new Set([...traceIds, ...owners])],
        center:
          "pcb_center" in error && error.pcb_center
            ? error.pcb_center
            : via
              ? { x: via.x, y: via.y }
              : undefined,
      }
    }
    if ("center" in error && error.center) {
      return error as DrcErrorWithCenter
    }

    if ("pcb_center" in error && error.pcb_center) {
      return {
        ...error,
        center: error.pcb_center,
      }
    }

    if ("pcb_via_ids" in error && Array.isArray(error.pcb_via_ids)) {
      const [viaAId, viaBId] = error.pcb_via_ids
      if (typeof viaAId !== "string" || typeof viaBId !== "string") {
        return error
      }
      const viaA = viasById.get(viaAId)
      const viaB = viasById.get(viaBId)

      if (viaA && viaB) {
        return {
          ...error,
          center: {
            x: (viaA.x + viaB.x) / 2,
            y: (viaA.y + viaB.y) / 2,
          },
        }
      }
    }

    if (
      "pcb_error_id" in error &&
      typeof error.pcb_error_id === "string" &&
      (error.pcb_error_id.startsWith("same_net_vias_close_") ||
        error.pcb_error_id.startsWith("different_net_vias_close_"))
    ) {
      const viaIds = error.pcb_error_id
        .replace("same_net_vias_close_", "")
        .replace("different_net_vias_close_", "")
        .split("_")
        .filter(Boolean)

      if (viaIds.length === 2) {
        const viaAId = viaIds[0]
        const viaBId = viaIds[1]
        if (!viaAId || !viaBId) return error
        const viaA = viasById.get(viaAId)
        const viaB = viasById.get(viaBId)

        if (viaA && viaB) {
          return {
            ...error,
            center: {
              x: (viaA.x + viaB.x) / 2,
              y: (viaA.y + viaB.y) / 2,
            },
          }
        }
      }
    }

    return error
  }) as DrcErrorWithCenter[]

  const locationAwareErrors = errorsWithCenters.filter(
    (error): error is LocationAwareDrcError => Boolean(error.center),
  )

  return {
    errors,
    errorsWithCenters,
    locationAwareErrors,
  }
}
