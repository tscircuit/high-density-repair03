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

const getContactOffsets = ({
  via,
  routes,
  pair,
}: {
  via: ViaNode
  routes: HighDensityRoute[]
  pair: Params["pair"]
}): { x: number; y: number }[] => {
  const offsets: { x: number; y: number }[] = []
  for (const route of routes) {
    if (
      route.connectionName === routes[via.routeIndex]!.connectionName ||
      !pair.includes(route.connectionName)
    )
      continue
    for (let index = 1; index < route.route.length; index++) {
      const a = route.route[index - 1]!,
        b = route.route[index]!
      if (
        a.z !== b.z ||
        !via.zLayers.includes(a.z) ||
        a.toNextSegmentType === "through_obstacle"
      )
        continue
      const dx = b.x - a.x,
        dy = b.y - a.y
      const squaredLength = dx * dx + dy * dy
      if (squaredLength === 0) continue
      const t = Math.max(
        0,
        Math.min(1, ((via.x - a.x) * dx + (via.y - a.y) * dy) / squaredLength),
      )
      const vx = via.x - a.x - t * dx,
        vy = via.y - a.y - t * dy
      const distance = Math.hypot(vx, vy)
      const depth = via.radius + route.traceThickness / 2 - distance
      if (depth <= 1e-9) continue
      const nx =
        distance > 1e-9 ? vx / distance : -dy / Math.sqrt(squaredLength)
      const ny = distance > 1e-9 ? vy / distance : dx / Math.sqrt(squaredLength)
      for (const margin of [0.001, 0.025, 0.05, 0.1])
        offsets.push({ x: nx * (depth + margin), y: ny * (depth + margin) })
    }
  }
  return offsets.slice(0, 8)
}

/** Joint moves for up to two contacting stacks; the owner bounds and validates
 * proposals against every other connection before accepting them. */
export function* getTraceViaContactRepairCandidates({
  srj,
  routes,
  pair,
}: Params): Generator<HighDensityRoute[]> {
  const vias = collectViaNodes(routes, srj).filter((via) => {
    const owner = routes[via.routeIndex]!
    if (!pair.includes(owner.connectionName) || !via.movable) return false
    if (
      via.pointIndexes.some(
        (index) =>
          owner.route[index]!.pcb_port_id ||
          owner.route[index]!.toNextSegmentType === "through_obstacle",
      ) ||
      owner.route[Math.min(...via.pointIndexes) - 1]?.toNextSegmentType ===
        "through_obstacle"
    )
      return false
    return routes.some((route) => {
      if (
        route.connectionName === owner.connectionName ||
        !pair.includes(route.connectionName)
      )
        return false
      return route.route.some((end, index) => {
        const start = route.route[index - 1]
        return (
          start !== undefined &&
          start.z === end.z &&
          start.toNextSegmentType !== "through_obstacle" &&
          via.zLayers.includes(start.z) &&
          segmentToSegmentMinDistance(start, end, via, via) <
            route.traceThickness / 2 + via.radius - 1e-9
        )
      })
    })
  })
  if (vias.length === 0 || vias.length > 2) return
  const offsets = [
    { x: 0, y: 0 },
    ...[0.05, 0.1, 0.2, 0.4].flatMap((distance) =>
      Array.from({ length: 8 }, (_, direction) => ({
        x: Math.cos((direction * Math.PI) / 4) * distance,
        y: Math.sin((direction * Math.PI) / 4) * distance,
      })),
    ),
  ]
  const routeIndexes = [...new Set(vias.map((via) => via.routeIndex))]
  const choices = vias.map((via) => [
    ...getContactOffsets({ via, routes, pair }),
    ...offsets,
  ])
  for (const first of choices[0]!)
    for (const second of choices[1] ?? [{ x: 0, y: 0 }]) {
      if (first.x === 0 && first.y === 0 && second.x === 0 && second.y === 0)
        continue
      const candidate = cloneRoutesForIndexes(routes, routeIndexes)
      let insideBounds = true
      for (const [index, via] of vias.entries()) {
        const offset = index === 0 ? first : second
        const x = via.x + offset.x,
          y = via.y + offset.y
        if (
          x - via.radius < srj.bounds.minX ||
          x + via.radius > srj.bounds.maxX ||
          y - via.radius < srj.bounds.minY ||
          y + via.radius > srj.bounds.maxY
        ) {
          insideBounds = false
          break
        }
        for (const pointIndex of via.pointIndexes) {
          candidate[via.routeIndex]!.route[pointIndex]!.x = x
          candidate[via.routeIndex]!.route[pointIndex]!.y = y
        }
      }
      if (insideBounds)
        yield materializeRoutesForIndexes(candidate, routeIndexes)
    }
}
