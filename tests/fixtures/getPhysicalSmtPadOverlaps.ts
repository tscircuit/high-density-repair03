import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../../lib"
import { getDrcSnapshot } from "../../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

export const getPhysicalSmtPadOverlaps = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  connMap?: ConnectivityMap,
) => {
  const contactDrc = new AutoroutingDrcEngine(srj, {
    // checkTraceObstacle compares gap + DRC_EPSILON against this threshold.
    // Offset its 0.005 mm epsilon so even smaller physical overlaps are seen.
    traceClearance: 0.005,
    viaClearance: 0,
    connMap,
  })
  return getDrcSnapshot(
    srj,
    routes,
    undefined,
    connMap,
    contactDrc,
  ).errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      String(error.message).includes("pcb_smtpad") &&
      Number(error.worst_actual_clearance ?? error.actual_clearance) < 0,
  )
}
