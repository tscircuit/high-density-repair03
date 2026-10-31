import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ViaNode } from "./internalTypes"
import {
  cloneRoutesForIndexes,
  collectViaNodes,
  materializeRoutesForIndexes,
} from "./solverHelpers"

type Params = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  pair: readonly [string, string]
}

/** Displace the contacting wire around each annulus, preserving terminals and
 * via stacks. Different contacts may need opposite displacement directions. */
export function* getTraceViaWireRepairCandidates({
  srj,
  routes,
  pair,
}: Params): Generator<HighDensityRoute[]> {
  const vias = collectViaNodes(routes, srj)
  for (const [routeIndex, route] of routes.entries()) {
    if (!pair.includes(route.connectionName)) continue
    const contacts: { pointIndex: number; via: ViaNode }[] = []
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
      const start = route.route[pointIndex - 1]!,
        end = route.route[pointIndex]!
      if (start.z !== end.z || start.toNextSegmentType === "through_obstacle")
        continue
      for (const via of vias) {
        if (
          routes[via.routeIndex]!.connectionName === route.connectionName ||
          !pair.includes(routes[via.routeIndex]!.connectionName) ||
          !via.zLayers.includes(start.z)
        )
          continue
        if (
          segmentToSegmentMinDistance(start, end, via, via) <
          route.traceThickness / 2 + via.radius - 1e-9
        )
          contacts.push({ pointIndex, via })
      }
    }
    if (contacts.length === 0) continue
    for (const side of [-1, 1])
      for (const margin of [0.001, 0.025, 0.05, 0.1, 0.2])
        for (const expansion of [0, 1, 2]) {
          const candidate = cloneRoutesForIndexes(routes, [routeIndex])
          let valid = true
          for (const { pointIndex, via } of contacts) {
            const a = route.route[pointIndex - 1]!,
              b = route.route[pointIndex]!
            const dx = b.x - a.x,
              dy = b.y - a.y,
              length = Math.hypot(dx, dy)
            if (length <= 1e-9) continue
            const nx = -dy / length,
              ny = dx / length
            const signedDistance = (via.x - a.x) * nx + (via.y - a.y) * ny
            const direction = (signedDistance > 0 ? -1 : 1) * side
            const target =
              signedDistance +
              direction * (via.radius + route.traceThickness / 2 + margin)
            for (
              let index = Math.max(1, pointIndex - 1 - expansion);
              index <= Math.min(route.route.length - 2, pointIndex + expansion);
              index++
            ) {
              const point = candidate[routeIndex]!.route[index]!
              const previous = route.route[index - 1]!,
                next = route.route[index + 1]!
              if (
                point.z !== a.z ||
                point.pcb_port_id ||
                previous.z !== point.z ||
                next.z !== point.z ||
                previous.toNextSegmentType === "through_obstacle" ||
                point.toNextSegmentType === "through_obstacle"
              )
                continue
              const offset =
                target - ((point.x - a.x) * nx + (point.y - a.y) * ny)
              point.x += nx * offset
              point.y += ny * offset
              const radius = route.traceThickness / 2
              if (
                point.x - radius < srj.bounds.minX ||
                point.x + radius > srj.bounds.maxX ||
                point.y - radius < srj.bounds.minY ||
                point.y + radius > srj.bounds.maxY
              )
                valid = false
            }
          }
          if (valid) yield materializeRoutesForIndexes(candidate, [routeIndex])
        }
  }
}
