import type { HighDensityRoute } from "../../types/high-density-types"
import {
  cloneRoutesForIndexes,
  materializeRoutesForIndexes,
} from "./solverHelpers"

/** Remove a complete layer excursion without deleting terminals or jumpers. */
export function* getTraceViaSimplificationCandidates(
  routes: HighDensityRoute[],
): Generator<HighDensityRoute[]> {
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex]!
    const transitions = route.route.flatMap((point, index) =>
      index > 0 && point.z !== route.route[index - 1]!.z ? [index] : [],
    )
    for (let via = 0; via + 1 < transitions.length; via++) {
      const start = transitions[via]!
      const end = transitions[via + 1]!
      const layer = route.route[start - 1]!.z
      if (
        route.route[end]!.z !== layer ||
        route.route
          .slice(start - 1, end + 1)
          .some((point) => point.toNextSegmentType === "through_obstacle") ||
        route.route.slice(start, end).some((point) => point.pcb_port_id)
      )
        continue
      for (const mode of ["chord", "flatten"] as const) {
        const candidate = cloneRoutesForIndexes(routes, [routeIndex])
        const changed = candidate[routeIndex]!
        if (mode === "chord") changed.route.splice(start, end - start)
        else {
          for (let index = start; index < end; index++) {
            changed.route[index]!.z = layer
          }
        }
        changed.route = changed.route.filter((point, index, points) => {
          const previous = points[index - 1]
          return (
            !previous ||
            point.pcb_port_id ||
            point.toNextSegmentType ||
            previous.toNextSegmentType ||
            point.insideJumperPad !== previous.insideJumperPad ||
            point.x !== previous.x ||
            point.y !== previous.y ||
            point.z !== previous.z
          )
        })
        yield materializeRoutesForIndexes(candidate, [routeIndex])
      }
    }
  }
}
