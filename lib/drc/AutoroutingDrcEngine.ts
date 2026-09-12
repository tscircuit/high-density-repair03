import {
  getSegmentIntersection,
  isPointInsidePolygon,
  pointToSegmentClosestPoint,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { distanceBetweenCircleAndPolygon } from "@tscircuit/circuit-json-util"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "../types"
import { getViaLayers } from "../utils/getViaLayers"
import { getObstaclePadMetadata } from "../utils/getObstaclePadMetadata"

type Point = { x: number; y: number }

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

type TraceSegment = {
  kind: "trace_segment"
  order: number
  traceId: string
  netId: string
  start: Point
  end: Point
  width: number
  layer: string
  pcbPortIds: string[]
}

type Via = {
  kind: "via"
  order: number
  viaId: string
  traceId: string
  netId: string
  x: number
  y: number
  diameter: number
  holeDiameter: number
  layers: string[]
}

type StaticObstacle = {
  kind: "obstacle"
  obstacleType: "pcb_smtpad" | "pcb_plated_hole"
  obstacleId: string
  connectedTo: string[]
  x: number
  y: number
  width: number
  height: number
  radius?: number
  polygon?: Point[]
  layers: string[]
  pcbPortId?: string
}

type DynamicCollidable = TraceSegment | Via

type TraceCollision = AutoroutingDrcError & {
  clearancePairId?: string
  contactPairId?: string
  suppressContact?: boolean
}

export type AutoroutingDrcError = {
  type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
    | "pcb_pad_trace_clearance_error"
    | "pcb_via_trace_clearance_error"
  error_type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
    | "pcb_pad_trace_clearance_error"
    | "pcb_via_trace_clearance_error"
  message: string
  center?: Point
  pcb_center?: Point
  pcb_via_pair_net_relation?: "same_net" | "different_net"
  [key: string]: unknown
}

export interface AutoroutingDrcResult {
  errors: AutoroutingDrcError[]
  errorsWithCenters: AutoroutingDrcError[]
  locationAwareErrors: Array<AutoroutingDrcError & { center: Point }>
}

export interface AutoroutingDrcEngineOptions {
  /**
   * Copper-edge clearance used for trace-to-trace, trace-to-via, and
   * trace-to-obstacle checks.
   */
  traceClearance?: number
  /**
   * Drill-edge clearance used for both same-net and different-net via pairs.
   */
  viaClearance?: number
  /** Copper-edge clearance used for via-to-pad checks. */
  viaToPadClearance?: number
  /**
   * Optional broad-phase cell size. The engine derives one from the board
   * bounds when this is omitted.
   */
  spatialCellSize?: number
  /**
   * Optional connectivity map for designs whose equivalent net identifiers
   * are not fully represented by the SRJ connection metadata.
   */
  connMap?: ConnectivityMap
  /**
   * Include explicit trace/via owner ids for preload-aware repair targeting.
   * Defaults to false so legacy callers receive the original error shape.
   */
  includeTraceViaOwnerMetadata?: boolean
}

export interface AutoroutingDrcEngineRunStats {
  traceCount: number
  segmentCount: number
  viaCount: number
  obstacleCount: number
  broadPhaseCandidateCount: number
  exactCheckCount: number
}

const DEFAULT_TRACE_CLEARANCE = 0.1
const DEFAULT_VIA_CLEARANCE = 0.1
const DEFAULT_VIA_TO_PAD_CLEARANCE = 0.1
const DEFAULT_BOARD_EDGE_CLEARANCE = 0.2
const DRC_EPSILON = 5e-3

const expandBounds = (bounds: Bounds, amount: number): Bounds => ({
  minX: bounds.minX - amount,
  minY: bounds.minY - amount,
  maxX: bounds.maxX + amount,
  maxY: bounds.maxY + amount,
})

const getSegmentBounds = (segment: TraceSegment): Bounds =>
  expandBounds(
    {
      minX: Math.min(segment.start.x, segment.end.x),
      minY: Math.min(segment.start.y, segment.end.y),
      maxX: Math.max(segment.start.x, segment.end.x),
      maxY: Math.max(segment.start.y, segment.end.y),
    },
    segment.width / 2,
  )

const getViaBounds = (via: Via): Bounds => {
  const radius = via.diameter / 2
  return {
    minX: via.x - radius,
    minY: via.y - radius,
    maxX: via.x + radius,
    maxY: via.y + radius,
  }
}

const getObstacleBounds = (obstacle: StaticObstacle): Bounds => {
  if (obstacle.polygon) {
    return {
      minX: Math.min(...obstacle.polygon.map((point) => point.x)),
      minY: Math.min(...obstacle.polygon.map((point) => point.y)),
      maxX: Math.max(...obstacle.polygon.map((point) => point.x)),
      maxY: Math.max(...obstacle.polygon.map((point) => point.y)),
    }
  }
  return {
    minX: obstacle.x - obstacle.width / 2,
    minY: obstacle.y - obstacle.height / 2,
    maxX: obstacle.x + obstacle.width / 2,
    maxY: obstacle.y + obstacle.height / 2,
  }
}

const getCellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

class SpatialHash<T> {
  private readonly cells = new Map<string, T[]>()

  constructor(private readonly cellSize: number) {}

  insert(item: T, bounds: Bounds) {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = getCellKey(cellX, cellY)
        const items = this.cells.get(key)
        if (items) {
          items.push(item)
        } else {
          this.cells.set(key, [item])
        }
      }
    }
  }

  query(bounds: Bounds): T[] {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    const results = new Set<T>()

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const items = this.cells.get(getCellKey(cellX, cellY))
        if (!items) continue
        for (const item of items) results.add(item)
      }
    }

    return [...results]
  }
}

const getClosestPointBetweenSegments = (
  segmentA: TraceSegment,
  segmentB: TraceSegment,
): Point => {
  const intersection = getSegmentIntersection(
    segmentA.start,
    segmentA.end,
    segmentB.start,
    segmentB.end,
  )
  if (intersection) return intersection

  const candidates = [
    {
      left: segmentA.start,
      right: pointToSegmentClosestPoint(
        segmentA.start,
        segmentB.start,
        segmentB.end,
      ),
    },
    {
      left: segmentA.end,
      right: pointToSegmentClosestPoint(
        segmentA.end,
        segmentB.start,
        segmentB.end,
      ),
    },
    {
      left: pointToSegmentClosestPoint(
        segmentB.start,
        segmentA.start,
        segmentA.end,
      ),
      right: segmentB.start,
    },
    {
      left: pointToSegmentClosestPoint(
        segmentB.end,
        segmentA.start,
        segmentA.end,
      ),
      right: segmentB.end,
    },
  ]

  let closest = {
    left: segmentA.start,
    right: segmentB.start,
  }
  let closestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.hypot(
      candidate.left.x - candidate.right.x,
      candidate.left.y - candidate.right.y,
    )
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return {
    x: (closest.left.x + closest.right.x) / 2,
    y: (closest.left.y + closest.right.y) / 2,
  }
}

type SegmentClearance = {
  distance: number
  tracePoint: Point
  obstaclePoint: Point
}

const getClosestPointsBetweenSegments = (
  start: Point,
  end: Point,
  obstacleStart: Point,
  obstacleEnd: Point,
): SegmentClearance => {
  const intersection = getSegmentIntersection(
    start,
    end,
    obstacleStart,
    obstacleEnd,
  )
  if (intersection) {
    return {
      distance: 0,
      tracePoint: intersection,
      obstaclePoint: intersection,
    }
  }
  const candidates = [
    {
      tracePoint: start,
      obstaclePoint: pointToSegmentClosestPoint(
        start,
        obstacleStart,
        obstacleEnd,
      ),
    },
    {
      tracePoint: end,
      obstaclePoint: pointToSegmentClosestPoint(
        end,
        obstacleStart,
        obstacleEnd,
      ),
    },
    {
      tracePoint: pointToSegmentClosestPoint(obstacleStart, start, end),
      obstaclePoint: obstacleStart,
    },
    {
      tracePoint: pointToSegmentClosestPoint(obstacleEnd, start, end),
      obstaclePoint: obstacleEnd,
    },
  ]
  let best = candidates[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.hypot(
      candidate.tracePoint.x - candidate.obstaclePoint.x,
      candidate.tracePoint.y - candidate.obstaclePoint.y,
    )
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return {
    ...best,
    distance: segmentToSegmentMinDistance(
      start,
      end,
      obstacleStart,
      obstacleEnd,
    ),
  }
}

const getSegmentToPolygonClearance = (
  start: Point,
  end: Point,
  polygon: Point[],
): SegmentClearance => {
  const intersections: Point[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const intersection = getSegmentIntersection(
      start,
      end,
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
    )
    if (intersection) intersections.push(intersection)
  }
  if (intersections.length > 0) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    intersections.sort(
      (left, right) => (left.x - right.x) * dx + (left.y - right.y) * dy,
    )
    return {
      distance: 0,
      tracePoint: intersections[0]!,
      obstaclePoint: intersections[0]!,
    }
  }
  if (
    isPointInsidePolygon(start, polygon) ||
    isPointInsidePolygon(end, polygon)
  ) {
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    return { distance: 0, tracePoint: center, obstaclePoint: center }
  }
  let best = getClosestPointsBetweenSegments(
    start,
    end,
    polygon[0]!,
    polygon[1]!,
  )
  for (let index = 1; index < polygon.length; index += 1) {
    const candidate = getClosestPointsBetweenSegments(
      start,
      end,
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
    )
    if (candidate.distance < best.distance) best = candidate
  }
  return best
}

const getCenterBetweenCopperEdges = (
  tracePoint: Point,
  obstaclePoint: Point,
  traceRadius: number,
  obstacleRadius: number,
): Point => {
  const dx = obstaclePoint.x - tracePoint.x
  const dy = obstaclePoint.y - tracePoint.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    return {
      x: (tracePoint.x + obstaclePoint.x) / 2,
      y: (tracePoint.y + obstaclePoint.y) / 2,
    }
  }
  if (distance <= traceRadius + obstacleRadius) {
    const overlapStart = Math.max(-traceRadius, distance - obstacleRadius)
    const overlapEnd = Math.min(traceRadius, distance + obstacleRadius)
    const offset = (overlapStart + overlapEnd) / (2 * distance)
    return {
      x: tracePoint.x + dx * offset,
      y: tracePoint.y + dy * offset,
    }
  }
  const offset = (traceRadius - obstacleRadius) / (2 * distance)
  return {
    x: (tracePoint.x + obstaclePoint.x) / 2 + dx * offset,
    y: (tracePoint.y + obstaclePoint.y) / 2 + dy * offset,
  }
}

const getRotatedRectangle = (
  center: Point,
  width: number,
  height: number,
  rotation: number,
): Point[] => {
  const angle = (rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((point) => ({
    x: center.x + point.x * cos - point.y * sin,
    y: center.y + point.x * sin + point.y * cos,
  }))
}

const getTracePortIds = (trace: SimplifiedPcbTrace) => {
  const portIds = new Set<string>()
  for (const routePoint of trace.route) {
    if (routePoint.route_type !== "wire") continue
    if (routePoint.start_pcb_port_id) {
      portIds.add(routePoint.start_pcb_port_id)
    }
    if (routePoint.end_pcb_port_id) {
      portIds.add(routePoint.end_pcb_port_id)
    }
  }
  return [...portIds]
}

const createTraceErrorMessage = (
  traceId: string,
  otherDescription: string,
  gap: number,
) =>
  gap <= 0
    ? `PCB trace ${traceId} overlaps with ${otherDescription} (accidental contact)`
    : `PCB trace ${traceId} is too close to ${otherDescription} (gap: ${gap.toFixed(
        3,
      )}mm)`

/**
 * A lightweight DRC evaluator for autorouting candidate scoring.
 *
 * Static SRJ obstacle geometry and connectivity aliases are compiled once in
 * the constructor. Each evaluation builds only the route-dependent trace/via
 * broad phase and performs exact distance checks for nearby objects.
 *
 * The geometric checks follow Core's trace contact, positive-clearance,
 * via drill-spacing, and board-edge rules. Connectivity and other non-geometric
 * checks remain the responsibility of the full-board validation suite.
 */
export class AutoroutingDrcEngine {
  private readonly traceClearance: number
  private readonly viaClearance: number
  private readonly viaToPadClearance: number
  private readonly boardEdgeClearance: number
  private readonly boardPolygon: Point[]
  private readonly cellSize: number
  private readonly connMap?: ConnectivityMap
  private readonly includeTraceViaOwnerMetadata: boolean
  private readonly canonicalNetByAlias = new Map<string, string>()
  private readonly connMapNetByCanonicalNet = new Map<string, string>()
  private readonly obstacles: StaticObstacle[]
  private readonly obstacleIndexesByLayer = new Map<
    string,
    SpatialHash<StaticObstacle>
  >()

  lastRunStats: AutoroutingDrcEngineRunStats = {
    traceCount: 0,
    segmentCount: 0,
    viaCount: 0,
    obstacleCount: 0,
    broadPhaseCandidateCount: 0,
    exactCheckCount: 0,
  }

  constructor(
    private readonly srj: SimpleRouteJson,
    options: AutoroutingDrcEngineOptions = {},
  ) {
    this.traceClearance =
      options.traceClearance ??
      this.srj.minTraceToPadEdgeClearance ??
      DEFAULT_TRACE_CLEARANCE
    this.viaClearance =
      options.viaClearance ??
      this.srj.minViaHoleEdgeToViaHoleEdgeClearance ??
      DEFAULT_VIA_CLEARANCE
    this.viaToPadClearance =
      options.viaToPadClearance ??
      this.srj.minPadEdgeToPadEdgeClearance ??
      DEFAULT_VIA_TO_PAD_CLEARANCE
    this.boardEdgeClearance =
      this.srj.minBoardEdgeClearance ?? DEFAULT_BOARD_EDGE_CLEARANCE
    this.boardPolygon =
      this.srj.outline && this.srj.outline.length > 0
        ? this.srj.outline
        : [
            { x: this.srj.bounds.minX, y: this.srj.bounds.minY },
            { x: this.srj.bounds.maxX, y: this.srj.bounds.minY },
            { x: this.srj.bounds.maxX, y: this.srj.bounds.maxY },
            { x: this.srj.bounds.minX, y: this.srj.bounds.maxY },
          ]
    this.connMap = options.connMap
    this.includeTraceViaOwnerMetadata =
      options.includeTraceViaOwnerMetadata ?? false
    this.cellSize = options.spatialCellSize ?? this.getDefaultSpatialCellSize()

    if (!Number.isFinite(this.traceClearance) || this.traceClearance < 0) {
      throw new Error("traceClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.viaClearance) || this.viaClearance < 0) {
      throw new Error("viaClearance must be a non-negative finite number")
    }
    if (
      !Number.isFinite(this.viaToPadClearance) ||
      this.viaToPadClearance < 0
    ) {
      throw new Error("viaToPadClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.cellSize) || this.cellSize <= 0) {
      throw new Error("spatialCellSize must be a positive finite number")
    }
    if (
      !Number.isFinite(this.boardEdgeClearance) ||
      this.boardEdgeClearance < 0
    ) {
      throw new Error("boardEdgeClearance must be a non-negative finite number")
    }

    this.compileConnectionAliases()
    this.obstacles = this.compileStaticObstacles()
    this.indexStaticObstacles()
  }

  private getDefaultSpatialCellSize() {
    const boardWidth = Math.max(0, this.srj.bounds.maxX - this.srj.bounds.minX)
    const boardHeight = Math.max(0, this.srj.bounds.maxY - this.srj.bounds.minY)
    return Math.max(
      0.25,
      Math.max(boardWidth, boardHeight) / 64,
      (this.srj.minViaDiameter ?? 0.3) +
        Math.max(this.traceClearance, this.viaToPadClearance),
    )
  }

  private compileConnectionAliases() {
    const connMapNetsByCanonicalNet = new Map<string, Set<string>>()
    const ambiguousAliases = new Set<string>()

    for (const connection of this.srj.connections) {
      const canonicalNet =
        connection.netConnectionName ??
        connection.rootConnectionName ??
        connection.name
      const aliases = [
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
        ...connection.pointsToConnect.flatMap((point) => [
          point.pointId,
          point.pcb_port_id,
        ]),
      ]

      for (const alias of aliases) {
        if (!alias || ambiguousAliases.has(alias)) continue
        const previousNet = this.canonicalNetByAlias.get(alias)
        if (previousNet !== undefined && previousNet !== canonicalNet) {
          this.canonicalNetByAlias.delete(alias)
          ambiguousAliases.add(alias)
          continue
        }
        this.canonicalNetByAlias.set(alias, canonicalNet)

        const connMapNetId = this.connMap?.getNetConnectedToId(alias)
        if (!connMapNetId) continue
        let connMapNets = connMapNetsByCanonicalNet.get(canonicalNet)
        if (!connMapNets) {
          connMapNets = new Set<string>()
          connMapNetsByCanonicalNet.set(canonicalNet, connMapNets)
        }
        connMapNets.add(connMapNetId)
      }
      if (!ambiguousAliases.has(canonicalNet)) {
        this.canonicalNetByAlias.set(canonicalNet, canonicalNet)
      }
    }

    // A sparse connectivity map may recognize only one alias in an SRJ net.
    // Promote only unambiguous map nets across the rest of that alias group.
    for (const [canonicalNet, connMapNets] of connMapNetsByCanonicalNet) {
      if (connMapNets.size !== 1) continue
      this.connMapNetByCanonicalNet.set(
        canonicalNet,
        connMapNets.values().next().value!,
      )
    }
  }

  private resolveNetId(id: string) {
    const connMapNetId = this.connMap?.getNetConnectedToId(id)
    if (connMapNetId) return connMapNetId
    const canonicalNet = this.canonicalNetByAlias.get(id)
    if (!canonicalNet) return id
    return this.connMapNetByCanonicalNet.get(canonicalNet) ?? canonicalNet
  }

  private areConnected(left: string, right: string) {
    if (left === right) return true
    if (this.connMap?.areIdsConnected(left, right)) return true
    return this.resolveNetId(left) === this.resolveNetId(right)
  }

  private compileStaticObstacles() {
    const obstacles: StaticObstacle[] = []
    const addedSmtPadIds = new Set<string>()
    const addedPlatedHoleIds = new Set<string>()
    const declaredPcbPortIds = new Set<string>()
    const portPositionMap = new Map<string, Point>()
    for (const connection of this.srj.connections) {
      for (const point of connection.pointsToConnect) {
        if (!point.pcb_port_id) continue
        declaredPcbPortIds.add(point.pcb_port_id)
        portPositionMap.set(point.pcb_port_id, { x: point.x, y: point.y })
      }
    }
    for (const obstacle of this.srj.obstacles) {
      const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
      if (!pcbPortId) continue
      declaredPcbPortIds.add(pcbPortId)
      if (!portPositionMap.has(pcbPortId)) {
        portPositionMap.set(pcbPortId, obstacle.center)
      }
    }

    for (const obstacle of this.srj.obstacles) {
      if (obstacle.layers.length === 0) continue
      const { smtPadId, platedHoleId, pcbPortId, viaId } =
        getObstaclePadMetadata(obstacle, declaredPcbPortIds, portPositionMap)
      if (viaId) continue
      if (!smtPadId && !platedHoleId && !pcbPortId) continue

      const isMultiLayer = Boolean(platedHoleId) || obstacle.layers.length > 1
      const obstacleType = isMultiLayer
        ? ("pcb_plated_hole" as const)
        : ("pcb_smtpad" as const)
      const obstacleId = isMultiLayer
        ? (platedHoleId ??
          `pcb_plated_hole_${obstacle.center.x.toFixed(
            3,
          )}_${obstacle.center.y.toFixed(3)}`)
        : (smtPadId ??
          `pcb_smtpad_${obstacle.center.x.toFixed(
            3,
          )}_${obstacle.center.y.toFixed(3)}`)
      const addedIds = isMultiLayer ? addedPlatedHoleIds : addedSmtPadIds
      if (addedIds.has(obstacleId)) continue
      addedIds.add(obstacleId)

      const hasRotation = Number.isFinite(obstacle.ccwRotationDegrees)
      const isCircular =
        isMultiLayer &&
        !hasRotation &&
        Math.abs(obstacle.width - obstacle.height) < 0.001
      const portNet = pcbPortId
        ? this.canonicalNetByAlias.get(pcbPortId)
        : undefined
      const declaredNets = new Set(
        obstacle.connectedTo.flatMap((id) => {
          const canonicalNet = this.canonicalNetByAlias.get(id)
          return canonicalNet ? [canonicalNet] : []
        }),
      )
      const obstacleNet =
        portNet ??
        (declaredNets.size === 1
          ? declaredNets.values().next().value
          : undefined)
      obstacles.push({
        kind: "obstacle",
        obstacleType,
        obstacleId,
        connectedTo: [
          ...(obstacleNet ? [obstacleNet] : []),
          ...(pcbPortId ? [pcbPortId] : []),
          obstacleId,
        ],
        x: obstacle.center.x,
        y: obstacle.center.y,
        width: obstacle.width,
        height: obstacle.height,
        ...(isCircular
          ? { radius: Math.max(obstacle.width, obstacle.height) / 2 }
          : {
              polygon: getRotatedRectangle(
                obstacle.center,
                obstacle.width,
                obstacle.height,
                obstacle.ccwRotationDegrees ?? 0,
              ),
            }),
        layers: obstacle.layers,
        ...(pcbPortId ? { pcbPortId } : {}),
      })
    }

    return obstacles
  }

  private indexStaticObstacles() {
    for (const obstacle of this.obstacles) {
      const bounds = expandBounds(
        getObstacleBounds(obstacle),
        Math.max(this.traceClearance, this.viaToPadClearance),
      )
      for (const layer of obstacle.layers) {
        let index = this.obstacleIndexesByLayer.get(layer)
        if (!index) {
          index = new SpatialHash<StaticObstacle>(this.cellSize)
          this.obstacleIndexesByLayer.set(layer, index)
        }
        index.insert(obstacle, bounds)
      }
    }
  }

  private collectDynamicGeometry(traces: SimplifiedPcbTraces) {
    const segments: TraceSegment[] = []
    const vias: Via[] = []
    const viaLocations = new Set<string>()

    for (const trace of traces) {
      const netId = this.resolveNetId(trace.connection_name)
      const pcbPortIds = getTracePortIds(trace)

      for (let index = 0; index < trace.route.length - 1; index += 1) {
        const start = trace.route[index]
        const end = trace.route[index + 1]
        if (
          start?.route_type !== "wire" ||
          end?.route_type !== "wire" ||
          start.layer !== end.layer
        ) {
          continue
        }
        segments.push({
          kind: "trace_segment",
          order: segments.length,
          traceId: trace.pcb_trace_id,
          netId,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          width: getWireWidth(start, end),
          layer: start.layer,
          pcbPortIds,
        })
      }

      for (const routePoint of trace.route) {
        if (routePoint.route_type !== "via") continue
        const locationKey = `${routePoint.x},${routePoint.y},${routePoint.from_layer},${routePoint.to_layer}`
        if (viaLocations.has(locationKey)) continue
        viaLocations.add(locationKey)

        vias.push({
          kind: "via",
          order: vias.length,
          viaId: `via_${vias.length}`,
          traceId: trace.pcb_trace_id,
          netId,
          x: routePoint.x,
          y: routePoint.y,
          diameter:
            routePoint.via_diameter ??
            this.srj.min_via_pad_diameter ??
            this.srj.minViaPadDiameter ??
            this.srj.minViaDiameter ??
            0.3,
          holeDiameter:
            routePoint.via_hole_diameter ??
            this.srj.min_via_hole_diameter ??
            this.srj.minViaHoleDiameter ??
            (this.srj.min_via_pad_diameter ??
              this.srj.minViaPadDiameter ??
              this.srj.minViaDiameter ??
              0.3) / 2,
          layers: getViaLayers(
            routePoint,
            this.srj.layerCount,
            this.srj.allowBlindAndBuriedVias,
          ),
        })
      }
    }

    return { segments, vias }
  }

  private buildDynamicIndexes(
    segments: TraceSegment[],
    vias: Via[],
  ): Map<string, SpatialHash<DynamicCollidable>> {
    const indexes = new Map<string, SpatialHash<DynamicCollidable>>()
    const addToLayer = (
      layer: string,
      item: DynamicCollidable,
      bounds: Bounds,
    ) => {
      let index = indexes.get(layer)
      if (!index) {
        index = new SpatialHash<DynamicCollidable>(this.cellSize)
        indexes.set(layer, index)
      }
      index.insert(item, expandBounds(bounds, this.traceClearance))
    }

    for (const segment of segments) {
      addToLayer(segment.layer, segment, getSegmentBounds(segment))
    }
    for (const via of vias) {
      for (const layer of via.layers) {
        addToLayer(layer, via, getViaBounds(via))
      }
    }

    return indexes
  }

  private obstacleSharesNet(netId: string, obstacle: StaticObstacle) {
    return obstacle.connectedTo.some((connectedId) =>
      this.areConnected(netId, connectedId),
    )
  }

  private checkTracePair(
    segmentA: TraceSegment,
    segmentB: TraceSegment,
  ): TraceCollision | undefined {
    if (this.areConnected(segmentA.netId, segmentB.netId)) return undefined
    const degenerateA =
      segmentA.start.x === segmentA.end.x && segmentA.start.y === segmentA.end.y
    const degenerateB =
      segmentB.start.x === segmentB.end.x && segmentB.start.y === segmentB.end.y
    if (degenerateA && degenerateB) return undefined
    if (degenerateA) return this.checkTracePair(segmentB, segmentA)
    this.lastRunStats.exactCheckCount += 1

    const gap =
      segmentToSegmentMinDistance(
        segmentA.start,
        segmentA.end,
        segmentB.start,
        segmentB.end,
      ) -
      segmentA.width / 2 -
      segmentB.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) return undefined

    const forwardId = `overlap_${segmentA.traceId}_${segmentB.traceId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      contactPairId: [segmentA.traceId, segmentB.traceId].sort().join("_"),
      message: createTraceErrorMessage(
        segmentA.traceId,
        `PCB trace ${segmentB.traceId}`,
        gap,
      ),
      pcb_trace_id: segmentA.traceId,
      source_trace_id: "",
      pcb_trace_error_id: forwardId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: [
        ...new Set([...segmentA.pcbPortIds, ...segmentB.pcbPortIds]),
      ],
      center: getClosestPointBetweenSegments(segmentA, segmentB),
    }
  }

  private checkTraceVia(
    segment: TraceSegment,
    via: Via,
  ): TraceCollision | undefined {
    if (this.areConnected(segment.netId, via.netId)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const gap =
      segmentToCircleMinDistance(segment.start, segment.end, {
        x: via.x,
        y: via.y,
        radius: via.diameter / 2,
      }) -
      segment.width / 2
    if (gap > 0 && gap + DRC_EPSILON >= this.traceClearance) return undefined

    const overlaps = gap <= 0
    const errorType = overlaps
      ? "pcb_trace_error"
      : "pcb_via_trace_clearance_error"
    const pairId = `${via.viaId}_${segment.traceId}`
    const errorId = overlaps
      ? `overlap_${segment.traceId}_${via.viaId}`
      : `via_trace_clearance_${pairId}`
    const closest = pointToSegmentClosestPoint(via, segment.start, segment.end)

    return {
      type: errorType,
      error_type: errorType,
      clearancePairId: `via_trace_clearance_${pairId}`,
      suppressContact:
        overlaps &&
        segment.start.x === segment.end.x &&
        segment.start.y === segment.end.y,
      message: createTraceErrorMessage(
        segment.traceId,
        `pcb_via "${via.viaId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      ...(this.includeTraceViaOwnerMetadata
        ? {
            pcb_trace_ids: [segment.traceId, via.traceId],
            pcb_via_id: via.viaId,
            pcb_via_ids: [via.viaId],
          }
        : {}),
      source_trace_id: "",
      ...(overlaps
        ? { pcb_trace_error_id: errorId }
        : {
            pcb_via_trace_clearance_error_id: errorId,
            pcb_via_id: via.viaId,
          }),
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: segment.pcbPortIds,
      center: getCenterBetweenCopperEdges(
        closest,
        via,
        segment.width / 2,
        via.diameter / 2,
      ),
    }
  }

  private checkTraceObstacle(
    segment: TraceSegment,
    obstacle: StaticObstacle,
  ): TraceCollision | undefined {
    if (this.obstacleSharesNet(segment.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const polygonClearance = obstacle.polygon
      ? getSegmentToPolygonClearance(
          segment.start,
          segment.end,
          obstacle.polygon,
        )
      : undefined
    const shapeDistance =
      obstacle.radius === undefined
        ? polygonClearance!.distance
        : segmentToCircleMinDistance(segment.start, segment.end, {
            x: obstacle.x,
            y: obstacle.y,
            radius: obstacle.radius,
          })
    const gap = shapeDistance - segment.width / 2
    if (gap > 0 && gap + DRC_EPSILON >= this.traceClearance) return undefined
    const overlaps = gap <= 0
    const errorType = overlaps
      ? "pcb_trace_error"
      : "pcb_pad_trace_clearance_error"
    const errorId = overlaps
      ? `overlap_${segment.traceId}_${obstacle.obstacleId}`
      : `pad_trace_clearance_${obstacle.obstacleId}_${segment.traceId}`
    const tracePoint =
      polygonClearance?.tracePoint ??
      pointToSegmentClosestPoint(obstacle, segment.start, segment.end)
    const obstaclePoint = polygonClearance?.obstaclePoint ?? obstacle

    return {
      type: errorType,
      error_type: errorType,
      clearancePairId: `pad_trace_clearance_${obstacle.obstacleId}_${segment.traceId}`,
      suppressContact:
        overlaps &&
        segment.start.x === segment.end.x &&
        segment.start.y === segment.end.y,
      message: createTraceErrorMessage(
        segment.traceId,
        `${obstacle.obstacleType} "${obstacle.obstacleId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      source_trace_id: "",
      ...(overlaps
        ? { pcb_trace_error_id: errorId }
        : {
            pcb_pad_trace_clearance_error_id: errorId,
            pcb_pad_id: obstacle.obstacleId,
          }),
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: [
        ...new Set([
          ...segment.pcbPortIds,
          ...(obstacle.pcbPortId ? [obstacle.pcbPortId] : []),
        ]),
      ],
      center: getCenterBetweenCopperEdges(
        tracePoint,
        obstaclePoint,
        segment.width / 2,
        obstacle.radius ?? 0,
      ),
    }
  }

  private checkViaObstacle(
    via: Via,
    obstacle: StaticObstacle,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(via.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const gap =
      obstacle.radius === undefined
        ? distanceBetweenCircleAndPolygon(
            { kind: "circle", x: via.x, y: via.y, radius: via.diameter / 2 },
            { kind: "polygon", points: obstacle.polygon! },
          )
        : Math.hypot(via.x - obstacle.x, via.y - obstacle.y) -
          obstacle.radius -
          via.diameter / 2
    if (gap + DRC_EPSILON >= this.viaToPadClearance) return undefined

    const errorId = `via_pad_clearance_${via.viaId}_${obstacle.obstacleId}`
    const polygonClearance = obstacle.polygon
      ? getSegmentToPolygonClearance(via, via, obstacle.polygon)
      : undefined
    const center = getCenterBetweenCopperEdges(
      via,
      polygonClearance?.obstaclePoint ?? obstacle,
      via.diameter / 2,
      obstacle.radius ?? 0,
    )

    return {
      type: "pcb_pad_pad_clearance_error",
      error_type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: errorId,
      message: `pcb_via "${via.viaId}" and ${obstacle.obstacleType} "${obstacle.obstacleId}" are too close (gap: ${gap.toFixed(3)}mm)`,
      pcb_trace_id: via.traceId,
      pcb_pad_ids: [via.viaId, obstacle.obstacleId],
      pcb_via_ids: [via.viaId],
      minimum_clearance: this.viaToPadClearance,
      actual_clearance: gap,
      center,
    }
  }

  private checkViaPairs(vias: Via[]): AutoroutingDrcError[] {
    if (vias.length < 2) return []
    const errors: AutoroutingDrcError[] = []
    const index = new SpatialHash<Via>(this.cellSize)
    for (const via of vias) {
      index.insert(
        via,
        expandBounds(
          {
            minX: via.x - via.holeDiameter / 2,
            minY: via.y - via.holeDiameter / 2,
            maxX: via.x + via.holeDiameter / 2,
            maxY: via.y + via.holeDiameter / 2,
          },
          this.viaClearance,
        ),
      )
    }

    for (const viaA of vias) {
      for (const viaB of index.query(getViaBounds(viaA))) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        if (viaB.order <= viaA.order) continue
        this.lastRunStats.exactCheckCount += 1

        const centerDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
        if (centerDistance <= DRC_EPSILON) continue
        const gap =
          centerDistance - viaA.holeDiameter / 2 - viaB.holeDiameter / 2
        if (gap + DRC_EPSILON >= this.viaClearance) continue

        const sameNet = this.areConnected(viaA.netId, viaB.netId)
        const pairId = [viaA.viaId, viaB.viaId].sort().join("_")
        const center = {
          x: (viaA.x + viaB.x) / 2,
          y: (viaA.y + viaB.y) / 2,
        }
        errors.push({
          type: "pcb_via_clearance_error",
          error_type: "pcb_via_clearance_error",
          pcb_error_id: `${
            sameNet ? "same_net" : "different_net"
          }_vias_close_${pairId}`,
          message: `Vias ${viaA.viaId} and ${viaB.viaId}${
            sameNet ? "" : " from different nets"
          } are too close together (gap: ${gap.toFixed(3)}mm)`,
          pcb_via_ids: [viaA.viaId, viaB.viaId],
          ...(this.includeTraceViaOwnerMetadata
            ? { pcb_trace_ids: [viaA.traceId, viaB.traceId] }
            : {}),
          pcb_via_pair_net_relation: sameNet ? "same_net" : "different_net",
          minimum_clearance: this.viaClearance,
          actual_clearance: gap,
          pcb_center: center,
          center,
        })
      }
    }

    return errors
  }

  private checkBoardEdges(traces: SimplifiedPcbTraces): AutoroutingDrcError[] {
    const errors: AutoroutingDrcError[] = []
    for (const trace of traces) {
      for (let index = 0; index < trace.route.length - 1; index += 1) {
        const start = trace.route[index]
        const end = trace.route[index + 1]
        if (start?.route_type !== "wire" || end?.route_type !== "wire") continue
        let distance = Number.POSITIVE_INFINITY
        for (
          let edgeIndex = 0;
          edgeIndex < this.boardPolygon.length;
          edgeIndex += 1
        ) {
          this.lastRunStats.exactCheckCount += 1
          distance = Math.min(
            distance,
            segmentToSegmentMinDistance(
              start,
              end,
              this.boardPolygon[edgeIndex]!,
              this.boardPolygon[(edgeIndex + 1) % this.boardPolygon.length]!,
            ),
          )
        }
        const requiredDistance =
          getWireWidth(start, end) / 2 + this.boardEdgeClearance
        if (distance >= requiredDistance) continue
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_error_id: `trace_too_close_to_board_${trace.pcb_trace_id}_segment_${index}`,
          message: `Trace too close to board edge (${distance.toFixed(3)}mm < ${requiredDistance.toFixed(3)}mm required, margin: ${this.boardEdgeClearance}mm)`,
          pcb_trace_id: trace.pcb_trace_id,
          source_trace_id: trace.connection_name,
          center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          actual_clearance: distance - getWireWidth(start, end) / 2,
          minimum_clearance: this.boardEdgeClearance,
          pcb_component_ids: [],
          pcb_port_ids: [],
        })
      }
    }
    return errors
  }

  evaluate(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces)
  }

  /**
   * Compatibility entrypoint for callers predating positive-clearance checks.
   * Both entrypoints use the same Core-aligned objective.
   */
  evaluateLegacy(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces)
  }

  private evaluateInternal(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    const { segments, vias } = this.collectDynamicGeometry(traces)
    const dynamicIndexesByLayer = this.buildDynamicIndexes(segments, vias)
    const detectedTraceErrors: TraceCollision[] = []
    const detectedViaPadErrors: AutoroutingDrcError[] = []

    this.lastRunStats = {
      traceCount: traces.length,
      segmentCount: segments.length,
      viaCount: vias.length,
      obstacleCount: this.obstacles.length,
      broadPhaseCandidateCount: 0,
      exactCheckCount: 0,
    }

    for (const segment of segments) {
      const queryBounds = getSegmentBounds(segment)
      const dynamicCandidates =
        dynamicIndexesByLayer.get(segment.layer)?.query(queryBounds) ?? []
      const obstacleCandidates =
        this.obstacleIndexesByLayer.get(segment.layer)?.query(queryBounds) ?? []

      for (const candidate of dynamicCandidates) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        if (
          candidate.kind === "trace_segment" &&
          candidate.order <= segment.order
        ) {
          continue
        }

        const error =
          candidate.kind === "trace_segment"
            ? this.checkTracePair(segment, candidate)
            : this.checkTraceVia(segment, candidate)
        if (error) detectedTraceErrors.push(error)
      }

      for (const obstacle of obstacleCandidates) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        const error = this.checkTraceObstacle(segment, obstacle)
        if (error) detectedTraceErrors.push(error)
      }
    }

    const detectedViaErrors = this.checkViaPairs(vias)

    {
      for (const via of vias) {
        const checkedObstacles = new Set<StaticObstacle>()
        for (const layer of via.layers) {
          const obstacleCandidates =
            this.obstacleIndexesByLayer.get(layer)?.query(getViaBounds(via)) ??
            []
          for (const obstacle of obstacleCandidates) {
            if (checkedObstacles.has(obstacle)) continue
            checkedObstacles.add(obstacle)
            this.lastRunStats.broadPhaseCandidateCount += 1
            const error = this.checkViaObstacle(via, obstacle)
            if (error) detectedViaPadErrors.push(error)
          }
        }
      }
    }

    const firstTraceErrorById = new Map<string, AutoroutingDrcError>()
    const clearanceErrorByPair = new Map<string, AutoroutingDrcError>()
    const overlappingPairs = new Set<string>()
    for (const error of detectedTraceErrors) {
      const {
        clearancePairId,
        contactPairId,
        suppressContact,
        ...publicError
      } = error
      if (error.type !== "pcb_trace_error") {
        if (!clearancePairId) {
          throw new Error(
            "A positive-clearance error must identify its copper pair",
          )
        }
        if (overlappingPairs.has(clearancePairId)) continue
        const existing = clearanceErrorByPair.get(clearancePairId)
        if (
          !existing ||
          Number(error.actual_clearance) < Number(existing.actual_clearance)
        ) {
          clearanceErrorByPair.set(clearancePairId, publicError)
        }
        continue
      }
      if (clearancePairId) {
        overlappingPairs.add(clearancePairId)
        clearanceErrorByPair.delete(clearancePairId)
      }
      if (suppressContact) continue
      const errorId = contactPairId ?? String(error.pcb_trace_error_id)
      const existing = firstTraceErrorById.get(errorId)
      const actualClearance = Number(error.actual_clearance)
      if (!existing) {
        firstTraceErrorById.set(errorId, {
          ...publicError,
          first_contact_center: error.center,
          first_contact_message: error.message,
          first_actual_clearance: actualClearance,
          worst_contact_center: error.center,
          worst_contact_message: error.message,
          worst_actual_clearance: actualClearance,
        })
        continue
      }
      const worstActualClearance = Number(existing.worst_actual_clearance)
      if (
        actualClearance < worstActualClearance ||
        !Number.isFinite(worstActualClearance)
      ) {
        existing.worst_contact_center = error.center
        existing.worst_contact_message = error.message
        existing.worst_actual_clearance = actualClearance
      }
    }
    const errors: AutoroutingDrcError[] = [...firstTraceErrorById.values()]
    errors.push(...clearanceErrorByPair.values())
    errors.push(...detectedViaPadErrors)
    errors.push(...detectedViaErrors)
    errors.push(...this.checkBoardEdges(traces))
    const errorsWithCenters = errors.filter((error) => error.center)
    const locationAwareErrors = errorsWithCenters as Array<
      AutoroutingDrcError & { center: Point }
    >

    return {
      errors,
      errorsWithCenters,
      locationAwareErrors,
    }
  }
}

const getWireWidth = (start: WireRoutePoint, end: WireRoutePoint): number =>
  start.width ?? end.width ?? 0.1
