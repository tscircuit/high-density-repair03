import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib"
import type { SimpleRouteConnection } from "../types/srj-types"

type CapturedConnection = SimpleRouteConnection & {
  __rootConnectionNames?: string[]
  __netConnectionName?: string
}

type CapturedTrace = SimplifiedPcbTrace & {
  connectsTo?: string[]
}

const getLayerZ = (layer: string, layerCount: number): number => {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(0, layerCount - 1)

  const innerLayerMatch = layer.match(/^inner(\d+)$/)
  if (innerLayerMatch) {
    const z = Number(innerLayerMatch[1])
    if (Number.isInteger(z) && z > 0 && z < layerCount - 1) return z
  }

  throw new Error(`Unsupported route layer: ${layer}`)
}

const pointHash = (point: { x: number; y: number }): string =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

export const getConnectivityMapFromSimpleRouteJson = (
  srj: SimpleRouteJson,
): ConnectivityMap => {
  const connMap = new ConnectivityMap({})

  for (const connection of srj.connections as CapturedConnection[]) {
    const connectionAliases = [
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([connectionAliases])

    for (const point of connection.pointsToConnect) {
      const pointLayers =
        "layers" in point
          ? point.layers
              .map((layer) => getLayerZ(layer, srj.layerCount))
              .sort()
              .join("-")
          : getLayerZ(point.layer, srj.layerCount)
      const pointAliases = [
        connection.name,
        `${pointHash(point)}:${pointLayers}`,
        point.pcb_port_id,
        point.pointId,
      ].filter((value): value is string => Boolean(value))
      connMap.addConnections([pointAliases])
    }
  }

  for (const obstacle of srj.obstacles) {
    const obstacleAliases = [
      obstacle.obstacleId,
      ...obstacle.connectedTo,
      ...(obstacle.offBoardConnectsTo ?? []),
      `${pointHash(obstacle.center)}:${obstacle.layers
        .map((layer) => getLayerZ(layer, srj.layerCount))
        .sort()
        .join("-")}`,
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([Array.from(new Set(obstacleAliases))])
  }

  for (const trace of (srj.traces ?? []) as CapturedTrace[]) {
    const traceAliases = [
      trace.pcb_trace_id,
      trace.connection_name,
      ...(trace.connectsTo ?? []),
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([Array.from(new Set(traceAliases))])
  }

  return connMap
}
