import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import {
  cloneRoutesForIndexes,
  materializeRoutesForIndexes,
} from "./solverHelpers"

type Params = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  previousRoutes: HighDensityRoute[]
  affectedConnections: ReadonlySet<string>
}

/** Move a complete via stack while preserving implicit and explicit terminals. */
export function* getPeerTraceViaCandidates({
  srj,
  routes,
  previousRoutes,
  affectedConnections,
}: Params): Generator<HighDensityRoute[]> {
  const previousVias = new Set(
    previousRoutes.flatMap((route) =>
      route.vias.map((via) => `${route.connectionName}:${via.x},${via.y}`),
    ),
  )
  let viaCount = 0
  for (const [routeIndex, route] of routes.entries()) {
    if (!affectedConnections.has(route.connectionName)) continue
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
      const a = route.route[pointIndex - 1]!,
        b = route.route[pointIndex]!
      if (
        a.z === b.z ||
        a.x !== b.x ||
        a.y !== b.y ||
        previousVias.has(`${route.connectionName}:${b.x},${b.y}`)
      )
        continue
      let start = pointIndex - 1,
        end = pointIndex
      while (
        start > 0 &&
        route.route[start - 1]!.x === b.x &&
        route.route[start - 1]!.y === b.y
      )
        start--
      while (
        end + 1 < route.route.length &&
        route.route[end + 1]!.x === b.x &&
        route.route[end + 1]!.y === b.y
      )
        end++
      pointIndex = end
      if (
        start === 0 ||
        end === route.route.length - 1 ||
        route.route[start - 1]!.toNextSegmentType === "through_obstacle" ||
        route.route
          .slice(start, end + 1)
          .some(
            (point) =>
              point.pcb_port_id ||
              point.toNextSegmentType === "through_obstacle",
          )
      )
        continue
      if (++viaCount > 8) return
      for (const distance of [0.05, 0.1, 0.4])
        for (let direction = 0; direction < 8; direction++) {
          const x = b.x + Math.cos((direction * Math.PI) / 4) * distance
          const y = b.y + Math.sin((direction * Math.PI) / 4) * distance
          const radius = route.viaDiameter / 2,
            bounds = srj.bounds
          if (
            x - radius < bounds.minX ||
            x + radius > bounds.maxX ||
            y - radius < bounds.minY ||
            y + radius > bounds.maxY
          )
            continue
          const candidate = cloneRoutesForIndexes(routes, [routeIndex])
          for (let index = start; index <= end; index++) {
            candidate[routeIndex]!.route[index]!.x = x
            candidate[routeIndex]!.route[index]!.y = y
          }
          yield materializeRoutesForIndexes(candidate, [routeIndex])
        }
    }
  }
}
