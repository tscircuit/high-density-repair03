import type { HighDensityRoute } from "../../types/high-density-types"
import { getNewTraceObstacleOverlapConnectionNames } from "./solverHelpers"
import type { DrcSnapshot } from "./types"

type ConnectionName = HighDensityRoute["connectionName"]

/** Propose a candidate that retains repairs outside the overlapping connections. */
export const restoreOverlappingConnections = ({
  routes,
  snapshot,
  inputSnapshot,
  checkpointRoutes,
}: {
  routes: HighDensityRoute[]
  snapshot: DrcSnapshot
  inputSnapshot: DrcSnapshot
  checkpointRoutes: HighDensityRoute[]
}):
  | { routes: HighDensityRoute[]; restoredConnectionCount: number }
  | undefined => {
  const connectionNames = getNewTraceObstacleOverlapConnectionNames(
    snapshot,
    inputSnapshot,
  )
  if (!connectionNames?.size) return undefined
  const checkpointByConnection = new Map<ConnectionName, HighDensityRoute[]>()
  for (const route of checkpointRoutes) {
    if (!connectionNames.has(route.connectionName)) continue
    const fragments = checkpointByConnection.get(route.connectionName)
    if (fragments) fragments.push(route)
    else checkpointByConnection.set(route.connectionName, [route])
  }
  if (checkpointByConnection.size !== connectionNames.size) return undefined
  const restoredConnections = new Set<ConnectionName>()
  const restoredRoutes: HighDensityRoute[] = []
  for (const route of routes) {
    if (!connectionNames.has(route.connectionName)) {
      restoredRoutes.push(route)
      continue
    }
    if (restoredConnections.has(route.connectionName)) continue
    restoredConnections.add(route.connectionName)
    restoredRoutes.push(...checkpointByConnection.get(route.connectionName)!)
  }
  if (restoredConnections.size !== connectionNames.size) return undefined
  // The caller must re-evaluate all interactions before accepting this mix.
  return {
    routes: restoredRoutes,
    restoredConnectionCount: restoredConnections.size,
  }
}
