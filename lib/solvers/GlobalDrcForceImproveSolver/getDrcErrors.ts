import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkSameNetViaSpacing,
} from "@tscircuit/checks"
import type { Point } from "graphics-debug"

type CircuitJsonElement = Record<string, unknown> & { type?: string }
type CircuitJson = CircuitJsonElement[]

type DrcError = Record<string, unknown> & {
  center?: Point
  pcb_center?: Point
  pcb_error_id?: string
  pcb_via_ids?: unknown
}

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
  // @tscircuit/checks is typed against the consumer's circuit-json package.
  // Keep this package's public helper structurally typed and cast only at the
  // package boundary to avoid leaking a second circuit-json union identity into
  // downstream source builds.
  const checksCircuitJson = circuitJson as unknown as Parameters<
    typeof checkEachPcbTraceNonOverlapping
  >[0]
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const traceErrors = checkEachPcbTraceNonOverlapping(checksCircuitJson, {
    minClearance: options.traceClearance,
  }) as unknown as DrcError[]
  const viaErrors = [
    ...checkSameNetViaSpacing(checksCircuitJson, {
      minClearance: viaClearance,
    }),
    ...checkDifferentNetViaSpacing(checksCircuitJson, {
      minClearance: viaClearance,
    }),
  ] as unknown as DrcError[]

  const errors: DrcError[] = [...traceErrors, ...viaErrors]

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
