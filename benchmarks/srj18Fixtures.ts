import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  HighDensityRoute,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../lib"
import type { SimpleRouteConnection } from "../types/srj-types"

export type CapturedSolverOptions = {
  effort?: number
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
  enableTargetedErrorSweep?: boolean
  enablePostSolveClearanceRelaxation?: boolean
  enableViaInPadLayerMoves?: boolean
}

export type StoredRepairFixture = {
  version: 1
  dataset: "srj18"
  sampleId: string
  scenarioName: string
  provenance: {
    repository: "tscircuit/tscircuit-autorouter"
    commit: string
    pipeline: string
    repairStage: string
  }
  params: CapturedSolverOptions & {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
}

export const SRJ18_SAMPLE_IDS = Array.from(
  { length: 16 },
  (_, index) => `sample${String(index + 1).padStart(3, "0")}`,
)

export const getLayerZ = (layer: string, layerCount: number) => {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(0, layerCount - 1)

  const innerLayerMatch = layer.match(/^inner(\d+)$/)
  if (innerLayerMatch) {
    const z = Number(innerLayerMatch[1])
    if (Number.isInteger(z) && z > 0 && z < layerCount - 1) return z
  }

  throw new Error(`Unsupported route layer: ${layer}`)
}

type CapturedConnection = SimpleRouteConnection & {
  __rootConnectionNames?: string[]
  __netConnectionName?: string
}

type CapturedTrace = SimplifiedPcbTrace & {
  connectsTo?: string[]
}

const pointHash = (point: { x: number; y: number }) =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

export const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson) => {
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

export const loadSrj18Sample = (sampleIndex: number): StoredRepairFixture => {
  const sampleId = SRJ18_SAMPLE_IDS[sampleIndex]
  if (!sampleId) {
    throw new Error(`Missing SRJ18 fixture at index ${sampleIndex}`)
  }

  const fixtureUrl = new URL(`./srj18/${sampleId}.json.gz`, import.meta.url)
  return JSON.parse(
    gunzipSync(readFileSync(fixtureUrl)).toString("utf8"),
  ) as StoredRepairFixture
}
