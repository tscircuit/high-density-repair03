import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type ConnectivityMapLike = {
  idToNetMap?: Record<string, string | undefined>
  getNetConnectedToId?: (id: string) => string | undefined
}

const netAliasCache = new Map<string, readonly string[]>()
const netAliasSetCache = new Map<string, ReadonlySet<string>>()
const obstacleConnectedAliasCache = new WeakMap<
  SimpleRouteJson["obstacles"][number],
  ReadonlySet<string>
>()

export const getRootConnectionName = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

export const getConnMapNetId = (
  connMap: ConnectivityMapLike | undefined,
  id: string | undefined,
) => {
  if (!connMap || !id) return undefined

  const netId = connMap.idToNetMap?.[id]
  if (netId) return netId

  return connMap.getNetConnectedToId?.(id)
}

export const getConnMapAwareSrj = (
  srj: SimpleRouteJson,
  connMap: ConnectivityMapLike | undefined,
): SimpleRouteJson => {
  if (!connMap) return srj

  return {
    ...srj,
    connections: srj.connections.map((connection) => {
      const netConnectionName =
        getConnMapNetId(connMap, connection.name) ??
        getConnMapNetId(connMap, connection.rootConnectionName) ??
        connection.netConnectionName

      return netConnectionName
        ? { ...connection, netConnectionName }
        : connection
    }),
    obstacles: srj.obstacles.map((obstacle) => {
      const connectedTo = new Set(obstacle.connectedTo)
      for (const connectedId of obstacle.connectedTo) {
        const netId = getConnMapNetId(connMap, connectedId)
        if (netId) connectedTo.add(netId)
      }

      return { ...obstacle, connectedTo: [...connectedTo] }
    }),
  }
}

const getNetAliases = (name: string | undefined) => {
  if (!name) return []

  const cachedAliases = netAliasCache.get(name)
  if (cachedAliases) return cachedAliases

  const aliases = name.includes("__")
    ? [...new Set([name, ...name.split("__").filter(Boolean)])]
    : [name]
  netAliasCache.set(name, aliases)
  return aliases
}

const getNetAliasSet = (name: string) => {
  const cachedAliasSet = netAliasSetCache.get(name)
  if (cachedAliasSet) return cachedAliasSet

  const aliasSet = new Set(getNetAliases(name))
  netAliasSetCache.set(name, aliasSet)
  return aliasSet
}

export const sharesNet = (
  left: string,
  right: string | undefined,
  connMap?: ConnectivityMapLike,
) => {
  if (!right) return false
  if (left === right) return true

  const leftNetId = getConnMapNetId(connMap, left)
  const rightNetId = getConnMapNetId(connMap, right)
  if (leftNetId && (leftNetId === right || leftNetId === rightNetId)) {
    return true
  }
  if (rightNetId && (rightNetId === left || rightNetId === leftNetId)) {
    return true
  }

  const leftAliases = getNetAliases(left)
  if (leftAliases.length === 1 && !right.includes("__")) return false

  const rightAliasSet = getNetAliasSet(right)
  return leftAliases.some((alias) => rightAliasSet.has(alias))
}

const getObstacleConnectedAliasSet = (
  obstacle: SimpleRouteJson["obstacles"][number],
) => {
  const cachedAliasSet = obstacleConnectedAliasCache.get(obstacle)
  if (cachedAliasSet) return cachedAliasSet

  const aliasSet = new Set<string>()
  for (const connectedTo of obstacle.connectedTo ?? []) {
    for (const alias of getNetAliases(connectedTo)) {
      aliasSet.add(alias)
    }
  }

  obstacleConnectedAliasCache.set(obstacle, aliasSet)
  return aliasSet
}

export const obstacleSharesNet = (
  rootConnectionName: string,
  obstacle: SimpleRouteJson["obstacles"][number],
  connMap?: ConnectivityMapLike,
) =>
  obstacle.connectedTo?.some((connectedTo) =>
    sharesNet(rootConnectionName, connectedTo, connMap),
  ) ||
  getNetAliases(rootConnectionName).some((alias) =>
    getObstacleConnectedAliasSet(obstacle).has(alias),
  )
