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

const hasSameCopper = (
  left: HighDensityRoute,
  right: HighDensityRoute,
): boolean => {
  if (
    left.connectionName !== right.connectionName ||
    left.rootConnectionName !== right.rootConnectionName ||
    left.traceThickness !== right.traceThickness ||
    left.route.length !== right.route.length
  )
    return false
  return left.route.every((point, index) => {
    const other = right.route[index]!
    return (
      point.x === other.x &&
      point.y === other.y &&
      point.z === other.z &&
      point.toNextSegmentType === other.toNextSegmentType
    )
  })
}

const addContact = (
  contacts: Map<ContactKey, Contact>,
  left: CopperSegment,
  right: CopperSegment,
): void => {
  if (
    left.start.z !== right.start.z ||
    left.net === right.net ||
    left.bounds.maxX <= right.bounds.minX ||
    right.bounds.maxX <= left.bounds.minX ||
    left.bounds.maxY <= right.bounds.minY ||
    right.bounds.maxY <= left.bounds.minY
  )
    return
  const pair: Contact =
    left.connectionName < right.connectionName
      ? [left.connectionName, right.connectionName]
      : [right.connectionName, left.connectionName]
  const key = JSON.stringify(pair)
  if (contacts.has(key)) return
  const gap =
    segmentToSegmentMinDistance(left.start, left.end, right.start, right.end) -
    left.radius -
    right.radius
  if (gap < -CONTACT_EPSILON) contacts.set(key, pair)
}

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

  /** Reuse stationary copper for a batch of local proposals. The copied
   * geometry also detects in-place mutations; route identity is not a cache key. */
  prepareCandidateCheck(
    referenceRoutes: HighDensityRoute[],
  ): (routes: HighDensityRoute[]) => Contact[] {
    const reference = structuredClone(referenceRoutes)
    const referenceContacts = this.collectContacts(reference)
    const copper = [...this.collectSegments(reference).values()].flat()
    const index = createSpatialIndex(
      copper,
      (segment) => segment.bounds,
      this.cellSize,
    )
    return (routes: HighDensityRoute[]): Contact[] => {
      if (routes.length !== reference.length)
        return this.getNewContactPairs(routes)
      const changedNames = new Set<ConnectionName>()
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const previous = reference[routeIndex]!,
          candidate = routes[routeIndex]!
        if (hasSameCopper(previous, candidate)) continue
        changedNames.add(previous.connectionName)
        changedNames.add(candidate.connectionName)
      }
      // A full scan is cheaper when the proposal changes much of the board.
      if (changedNames.size > routes.length / 4)
        return this.getNewContactPairs(routes)
      const contacts = new Map(
        [...referenceContacts].filter(
          ([, pair]) =>
            !changedNames.has(pair[0]) && !changedNames.has(pair[1]),
        ),
      )
      // Include every fragment of a changed logical connection, even when
      // only one fragment moved and another still touches its original peer.
      const changedCopper = [
        ...this.collectSegments(
          routes.filter((route) => changedNames.has(route.connectionName)),
        ).values(),
      ].flat()
      for (let i = 0; i < changedCopper.length; i++) {
        const left = changedCopper[i]!
        for (const candidateIndex of getSpatialCandidateIndexes(
          index,
          left.bounds,
          this.cellSize,
        )) {
          const right = copper[candidateIndex]!
          if (!changedNames.has(right.connectionName))
            addContact(contacts, left, right)
        }
        for (let j = i + 1; j < changedCopper.length; j++)
          addContact(contacts, left, changedCopper[j]!)
      }
      return [...contacts]
        .filter(([key]) => !this.inputContacts.has(key))
        .map(([, pair]) => pair)
    }
  }

  private collectSegments(
    routes: HighDensityRoute[],
  ): Map<number, CopperSegment[]> {
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
    return layers
  }

  private collectContacts(
    routes: HighDensityRoute[],
  ): Map<ContactKey, Contact> {
    const contacts = new Map<ContactKey, Contact>()
    for (const segments of this.collectSegments(routes).values()) {
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
          addContact(contacts, left, segments[j]!)
        }
      }
    }
    return contacts
  }
}
