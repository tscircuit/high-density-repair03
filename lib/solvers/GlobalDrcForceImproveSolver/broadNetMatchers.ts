import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import { obstacleSharesNet, sharesNet } from "./netUtils"

type RouteOwner = { routeIndex: number; rootConnectionName: string }
type Obstacle = SimpleRouteJson["obstacles"][number]

export type BroadNetMatchers = {
  routesShareNet: (left: RouteOwner, right: RouteOwner) => boolean
  forObstacle: (obstacle: Obstacle) => (route: RouteOwner) => boolean
}

// Bound each byte table to 1 MiB; larger inputs retain the uncached predicate.
const MAX_MATCH_CELLS = 1_048_576

/** One synchronous broad-force call; its passes change coordinates, not nets. */
export const createBroadNetMatchers = (
  routeCount: number,
  obstacleCount: number,
  connMap?: ConnectivityMap,
): BroadNetMatchers => {
  const routeMatches =
    routeCount * routeCount <= MAX_MATCH_CELLS
      ? new Uint8Array(routeCount * routeCount)
      : undefined
  const cacheObstacles = routeCount * obstacleCount <= MAX_MATCH_CELLS
  const obstacleMatchers = new WeakMap<
    Obstacle,
    (route: RouteOwner) => boolean
  >()

  return {
    routesShareNet: (left, right) => {
      const index = left.routeIndex * routeCount + right.routeIndex
      const cached = routeMatches?.[index]
      if (cached) return cached === 2
      const result = sharesNet(
        left.rootConnectionName,
        right.rootConnectionName,
        connMap,
      )
      if (routeMatches) routeMatches[index] = result ? 2 : 1
      return result
    },
    forObstacle: (obstacle) => {
      let matcher = obstacleMatchers.get(obstacle)
      if (matcher) return matcher
      const routeMatches = cacheObstacles
        ? new Uint8Array(routeCount)
        : undefined
      matcher = (route) => {
        const cached = routeMatches?.[route.routeIndex]
        if (cached) return cached === 2
        const result = obstacleSharesNet(
          route.rootConnectionName,
          obstacle,
          connMap,
        )
        if (routeMatches) routeMatches[route.routeIndex] = result ? 2 : 1
        return result
      }
      obstacleMatchers.set(obstacle, matcher)
      return matcher
    },
  }
}
