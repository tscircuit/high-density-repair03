import type { HighDensityRoute } from "../../types/high-density-types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getNewTraceCopperOverlapConnectionNames,
  getNewTraceObstacleOverlapConnectionNames,
} from "./solverHelpers"
import type { DrcSnapshot } from "./types"

type ConnectionName = HighDensityRoute["connectionName"]

type RestorationParams = {
  routes: HighDensityRoute[]
  snapshot: DrcSnapshot
  inputSnapshot: DrcSnapshot
  inputRoutes: HighDensityRoute[]
  connMap?: ConnectivityMap
  checkpointRoutes: HighDensityRoute[]
}

type RestoredConnections = {
  routes: HighDensityRoute[]
  restoredConnectionCount: number
}

const restoreConnections = (
  routes: HighDensityRoute[],
  checkpointRoutes: HighDensityRoute[],
  connectionNames: ReadonlySet<ConnectionName>,
): RestoredConnections | undefined => {
  if (connectionNames.size === 0) return undefined
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

/** Propose a candidate that retains repairs outside the overlapping connections. */
export const restoreOverlappingConnections = ({
  routes,
  snapshot,
  inputSnapshot,
  inputRoutes,
  connMap,
  checkpointRoutes,
}: RestorationParams): RestoredConnections | undefined => {
  const connectionNames = getNewTraceCopperOverlapConnectionNames(
    snapshot,
    inputSnapshot,
    routes,
    inputRoutes,
    connMap,
  )
  if (!connectionNames?.size) return undefined
  return restoreConnections(routes, checkpointRoutes, connectionNames)
}

/** Keep obstacle-only progress when that restoration already clears peer shorts. */
export const getOverlapRestorationCandidates = (
  params: RestorationParams,
): RestoredConnections[] => {
  const obstacleNames = getNewTraceObstacleOverlapConnectionNames(
    params.snapshot,
    params.inputSnapshot,
  )
  const allNames = getNewTraceCopperOverlapConnectionNames(
    params.snapshot,
    params.inputSnapshot,
    params.routes,
    params.inputRoutes,
    params.connMap,
  )
  if (!obstacleNames || !allNames) return []
  const nameSets = [obstacleNames]
  if (
    obstacleNames.size !== allNames.size ||
    [...allNames].some((name) => !obstacleNames.has(name))
  ) {
    nameSets.push(allNames)
  }
  const candidates: RestoredConnections[] = []
  // At most two mixes are validated; no new routing search is performed.
  for (const names of nameSets) {
    const restored = restoreConnections(
      params.routes,
      params.checkpointRoutes,
      names,
    )
    if (restored) candidates.push(restored)
  }
  return candidates
}
