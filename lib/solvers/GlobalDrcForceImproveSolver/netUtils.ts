import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export const getRootConnectionName = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

export const getConnMapNetId = (
  connMap: ConnectivityMap | undefined,
  id: string | undefined,
) => {
  if (!connMap || !id) return undefined
  return connMap.getNetConnectedToId(id)
}

export const getConnMapAwareSrj = (
  srj: SimpleRouteJson,
  connMap: ConnectivityMap | undefined,
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

export const sharesNet = (
  left: string,
  right: string | undefined,
  connMap?: ConnectivityMap,
) => {
  if (!right) return false
  if (left === right) return true
  if (connMap?.areIdsConnected(left, right)) return true

  const leftNetId = getConnMapNetId(connMap, left)
  const rightNetId = getConnMapNetId(connMap, right)
  if (leftNetId && (leftNetId === right || leftNetId === rightNetId)) {
    return true
  }
  if (rightNetId && (rightNetId === left || rightNetId === leftNetId)) {
    return true
  }

  return false
}

export const obstacleSharesNet = (
  rootConnectionName: string,
  obstacle: SimpleRouteJson["obstacles"][number],
  connMap?: ConnectivityMap,
) =>
  obstacle.connectedTo?.some((connectedTo) =>
    sharesNet(rootConnectionName, connectedTo, connMap),
  ) ?? false
