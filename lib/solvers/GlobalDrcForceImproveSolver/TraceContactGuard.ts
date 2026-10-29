import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Bounds2D } from "./internalTypes"
import { createSpatialIndex, getSpatialCandidateIndexes } from "./spatialIndex"

type ConnectionName = HighDensityRoute["connectionName"]
type ContactKey = string
type RoutePoint = HighDensityRoute["route"][number]
type CopperSegment = {
  connectionName: ConnectionName
  net: string
  start: RoutePoint
  end: RoutePoint
  radius: number
  bounds: Bounds2D
}
type Contact = readonly [ConnectionName, ConnectionName]
type GuardParams = {
  srj: SimpleRouteJson
  inputRoutes: HighDensityRoute[]
  connMap?: ConnectivityMap
}

// Numerical roundoff only; positive clearance tolerances do not excuse shorts.
const CONTACT_EPSILON = 1e-9

/** Physical wire contacts, independent of a caller's DRC reporting policy. */
export class TraceContactGuard {
  private readonly connectivity: ConnectivityMap
  private readonly inputContacts: Map<ContactKey, Contact>
  private readonly cellSize: number

  constructor({ srj, inputRoutes, connMap }: GuardParams) {
    this.cellSize = Math.max(
      1,
      (srj.bounds.maxX - srj.bounds.minX) / 64,
      (srj.bounds.maxY - srj.bounds.minY) / 64,
    )
    this.connectivity = new ConnectivityMap({})
    this.connectivity.addConnections([
      ...Object.entries(connMap?.netMap ?? {}).map(([net, ids]) => [
        net,
        ...ids,
      ]),
      ...srj.connections.map((connection) =>
        [
          connection.name,
          connection.rootConnectionName,
          connection.netConnectionName,
          ...(connection.mergedConnectionNames ?? []),
          ...connection.pointsToConnect.flatMap((point) => [
            point.pointId,
            point.pcb_port_id,
          ]),
        ].filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
      ...inputRoutes.map((route) => [
        route.connectionName,
        route.rootConnectionName ?? route.connectionName,
      ]),
    ])
    this.inputContacts = this.collectContacts(inputRoutes)
  }

  getNewContactConnectionNames(
    routes: HighDensityRoute[],
  ): Set<ConnectionName> {
    const connections = new Set<ConnectionName>()
    for (const pair of this.getNewContactPairs(routes)) {
      connections.add(pair[0])
      connections.add(pair[1])
    }
    return connections
  }

  getNewContactPairs(routes: HighDensityRoute[]): Contact[] {
    return [...this.collectContacts(routes)]
      .filter(([key]) => !this.inputContacts.has(key))
      .map(([, pair]) => pair)
  }

  /** Cheap rejection before checking a local proposal against the whole board. */
  hasContactPair(routes: HighDensityRoute[], pair: Contact): boolean {
    const pairRoutes = routes.filter(
      (route) =>
        route.connectionName === pair[0] || route.connectionName === pair[1],
    )
    return this.collectContacts(pairRoutes).has(JSON.stringify(pair))
  }

  /** Later repair must not recreate an input contact that was already cleared. */
  preserveClearedContacts(routes: HighDensityRoute[]): void {
    const remaining = this.collectContacts(routes)
    for (const key of this.inputContacts.keys()) {
      if (!remaining.has(key)) this.inputContacts.delete(key)
    }
  }

  private collectContacts(
    routes: HighDensityRoute[],
  ): Map<ContactKey, Contact> {
    const contacts = new Map<ContactKey, Contact>()
    const layers = new Map<number, CopperSegment[]>()
    for (const route of routes) {
      const net =
        this.connectivity.getNetConnectedToId(route.connectionName) ??
        route.rootConnectionName ??
        route.connectionName
      const radius = route.traceThickness / 2
      for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
        const start = route.route[pointIndex - 1]!
        const end = route.route[pointIndex]!
        if (
          start.z !== end.z ||
          start.toNextSegmentType === "through_obstacle"
        ) {
          continue
        }
        let segments = layers.get(start.z)
        if (!segments) {
          segments = []
          layers.set(start.z, segments)
        }
        segments.push({
          connectionName: route.connectionName,
          net,
          start,
          end,
          radius,
          bounds: {
            minX: Math.min(start.x, end.x) - radius,
            minY: Math.min(start.y, end.y) - radius,
            maxX: Math.max(start.x, end.x) + radius,
            maxY: Math.max(start.y, end.y) + radius,
          },
        })
      }
    }
    for (const segments of layers.values()) {
      const index = createSpatialIndex(
        segments,
        (segment) => segment.bounds,
        this.cellSize,
      )
      for (let i = 0; i < segments.length; i++) {
        const left = segments[i]!
        for (const j of getSpatialCandidateIndexes(
          index,
          left.bounds,
          this.cellSize,
        )) {
          if (j <= i) continue
          const right = segments[j]!
          if (
            left.net === right.net ||
            left.bounds.maxX <= right.bounds.minX ||
            right.bounds.maxX <= left.bounds.minX ||
            left.bounds.maxY <= right.bounds.minY ||
            right.bounds.maxY <= left.bounds.minY
          ) {
            continue
          }
          const pair: Contact =
            left.connectionName < right.connectionName
              ? [left.connectionName, right.connectionName]
              : [right.connectionName, left.connectionName]
          const key = JSON.stringify(pair)
          if (contacts.has(key)) continue
          const gap =
            segmentToSegmentMinDistance(
              left.start,
              left.end,
              right.start,
              right.end,
            ) -
            left.radius -
            right.radius
          if (gap < -CONTACT_EPSILON) contacts.set(key, pair)
        }
      }
    }
    return contacts
  }
}
