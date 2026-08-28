import {
  getSegmentIntersection,
  pointToSegmentClosestPoint,
  segmentToBoundsMinDistance,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "../types"

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
  layers: string[]
  pcbPortId?: string
}

type DynamicCollidable = TraceSegment | Via

export type AutoroutingDrcError = {
  type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
  error_type:
    | "pcb_trace_error"
    | "pcb_via_clearance_error"
    | "pcb_pad_pad_clearance_error"
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
   * Copper-edge clearance used for both same-net and different-net via pairs.
   * Values below 0.1 mm are clamped to the repair solver's safety minimum.
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
const MIN_VIA_CLEARANCE = 0.1
const DEFAULT_VIA_TO_PAD_CLEARANCE = 0.1
const DRC_EPSILON = 5e-3
const POSITION_EPSILON = 1e-6

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

const getObstacleBounds = (obstacle: StaticObstacle): Bounds => ({
  minX: obstacle.x - obstacle.width / 2,
  minY: obstacle.y - obstacle.height / 2,
  maxX: obstacle.x + obstacle.width / 2,
  maxY: obstacle.y + obstacle.height / 2,
})

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

const getClosestPointBetweenSegmentAndPoint = (
  segment: TraceSegment,
  point: Point,
): Point => {
  const closest = pointToSegmentClosestPoint(point, segment.start, segment.end)
  return {
    x: (closest.x + point.x) / 2,
    y: (closest.y + point.y) / 2,
  }
}

const getClosestPointBetweenSegmentAndBounds = (
  segment: TraceSegment,
  bounds: Bounds,
): Point => {
  const boundsCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const pointOnSegment = pointToSegmentClosestPoint(
    boundsCenter,
    segment.start,
    segment.end,
  )
  const pointOnBounds = {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, pointOnSegment.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, pointOnSegment.y)),
  }

  return {
    x: (pointOnSegment.x + pointOnBounds.x) / 2,
    y: (pointOnSegment.y + pointOnBounds.y) / 2,
  }
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
  gap < 0
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
 * This intentionally implements the checks used by the repair solver's
 * relaxed objective. It is not a replacement for the full-board
 * `@tscircuit/checks` validation suite.
 */
export class AutoroutingDrcEngine {
  private readonly traceClearance: number
  private readonly viaClearance: number
  private readonly viaToPadClearance: number
  private readonly cellSize: number
  private readonly connMap?: ConnectivityMap
  private readonly includeTraceViaOwnerMetadata: boolean
  private readonly canonicalNetByAlias = new Map<string, string>()
  private readonly connMapNetByCanonicalNet = new Map<string, string>()
  private readonly resolvedNetIdById = new Map<string, string>()
  private readonly connectivityByOrderedPair = new Map<
    string,
    Map<string, boolean>
  >()
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
    this.traceClearance = options.traceClearance ?? DEFAULT_TRACE_CLEARANCE
    this.viaClearance = Math.max(
      options.viaClearance ?? MIN_VIA_CLEARANCE,
      MIN_VIA_CLEARANCE,
    )
    this.viaToPadClearance =
      options.viaToPadClearance ??
      this.srj.minViaEdgeToPadEdgeClearance ??
      DEFAULT_VIA_TO_PAD_CLEARANCE
    this.connMap = options.connMap
    this.includeTraceViaOwnerMetadata =
      options.includeTraceViaOwnerMetadata ?? false
    this.cellSize = options.spatialCellSize ?? this.getDefaultSpatialCellSize()

    if (!Number.isFinite(this.traceClearance) || this.traceClearance < 0) {
      throw new Error("traceClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.viaClearance)) {
      throw new Error("viaClearance must be a finite number")
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
        if (!alias) continue
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
      this.canonicalNetByAlias.set(canonicalNet, canonicalNet)
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
    const cachedNetId = this.resolvedNetIdById.get(id)
    if (cachedNetId !== undefined) return cachedNetId

    const connMapNetId = this.connMap?.getNetConnectedToId(id)
    const canonicalNet = this.canonicalNetByAlias.get(id)
    const resolvedNetId =
      connMapNetId ??
      (canonicalNet
        ? (this.connMapNetByCanonicalNet.get(canonicalNet) ?? canonicalNet)
        : id)
    this.resolvedNetIdById.set(id, resolvedNetId)
    return resolvedNetId
  }

  private areConnected(left: string, right: string) {
    if (left === right) return true
    let byRight = this.connectivityByOrderedPair.get(left)
    const cachedResult = byRight?.get(right)
    if (cachedResult !== undefined) return cachedResult

    const areConnected =
      Boolean(this.connMap?.areIdsConnected(left, right)) ||
      this.resolveNetId(left) === this.resolveNetId(right)
    if (!byRight) {
      byRight = new Map()
      this.connectivityByOrderedPair.set(left, byRight)
    }
    byRight.set(right, areConnected)
    return areConnected
  }

  private compileStaticObstacles() {
    const obstacles: StaticObstacle[] = []
    const addedSmtPadIds = new Set<string>()
    const addedPlatedHoleIds = new Set<string>()

    for (const obstacle of this.srj.obstacles) {
      if (obstacle.layers.length === 0) continue
      const smtPadId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_smtpad_"),
      )
      const platedHoleId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_plated_hole_"),
      )
      const pcbPortId = obstacle.connectedTo.find((id) =>
        id.startsWith("pcb_port_"),
      )
      if (!smtPadId && !platedHoleId && !pcbPortId) continue

      const isMultiLayer = obstacle.layers.length > 1
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

      const isCircular =
        isMultiLayer && Math.abs(obstacle.width - obstacle.height) < 0.001
      obstacles.push({
        kind: "obstacle",
        obstacleType,
        obstacleId,
        connectedTo: obstacle.connectedTo,
        x: obstacle.center.x,
        y: obstacle.center.y,
        width: obstacle.width,
        height: obstacle.height,
        ...(isCircular
          ? { radius: Math.max(obstacle.width, obstacle.height) / 2 }
          : {}),
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
        if (
          Math.abs(start.x - end.x) <= POSITION_EPSILON &&
          Math.abs(start.y - end.y) <= POSITION_EPSILON
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
          diameter: routePoint.via_diameter ?? this.srj.minViaDiameter ?? 0.3,
          layers: [routePoint.from_layer, routePoint.to_layer],
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
  ): AutoroutingDrcError | undefined {
    if (this.areConnected(segmentA.netId, segmentB.netId)) return undefined
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
  ): AutoroutingDrcError | undefined {
    if (this.areConnected(segment.netId, via.netId)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const gap =
      segmentToCircleMinDistance(segment.start, segment.end, {
        x: via.x,
        y: via.y,
        radius: via.diameter / 2,
      }) -
      segment.width / 2
    if (gap > this.traceClearance - DRC_EPSILON) return undefined

    const errorId = `overlap_${segment.traceId}_${via.viaId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
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
      pcb_trace_error_id: errorId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: segment.pcbPortIds,
      center: getClosestPointBetweenSegmentAndPoint(segment, via),
    }
  }

  private checkTraceObstacle(
    segment: TraceSegment,
    obstacle: StaticObstacle,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(segment.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const obstacleBounds = getObstacleBounds(obstacle)
    const shapeDistance =
      obstacle.radius === undefined
        ? segmentToBoundsMinDistance(segment.start, segment.end, obstacleBounds)
        : segmentToCircleMinDistance(segment.start, segment.end, {
            x: obstacle.x,
            y: obstacle.y,
            radius: obstacle.radius,
          })
    const gap = shapeDistance - segment.width / 2
    if (gap + DRC_EPSILON >= this.traceClearance) return undefined

    const errorId = `overlap_${segment.traceId}_${obstacle.obstacleId}`

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segment.traceId,
        `${obstacle.obstacleType} "${obstacle.obstacleId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      source_trace_id: "",
      pcb_trace_error_id: errorId,
      minimum_clearance: this.traceClearance,
      actual_clearance: gap,
      pcb_component_ids: [],
      pcb_port_ids: [
        ...new Set([
          ...segment.pcbPortIds,
          ...(obstacle.pcbPortId ? [obstacle.pcbPortId] : []),
        ]),
      ],
      center:
        obstacle.radius === undefined
          ? getClosestPointBetweenSegmentAndBounds(segment, obstacleBounds)
          : getClosestPointBetweenSegmentAndPoint(segment, obstacle),
    }
  }

  private checkViaObstacle(
    via: Via,
    obstacle: StaticObstacle,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(via.netId, obstacle)) return undefined
    this.lastRunStats.exactCheckCount += 1

    const obstacleBounds = getObstacleBounds(obstacle)
    const pointToObstacleDistance =
      obstacle.radius === undefined
        ? Math.hypot(
            Math.max(
              obstacleBounds.minX - via.x,
              0,
              via.x - obstacleBounds.maxX,
            ),
            Math.max(
              obstacleBounds.minY - via.y,
              0,
              via.y - obstacleBounds.maxY,
            ),
          )
        : Math.hypot(via.x - obstacle.x, via.y - obstacle.y) - obstacle.radius
    const gap = pointToObstacleDistance - via.diameter / 2
    if (gap + DRC_EPSILON >= this.viaToPadClearance) return undefined

    const errorId = `via_pad_clearance_${via.viaId}_${obstacle.obstacleId}`
    const center = {
      x: (via.x + obstacle.x) / 2,
      y: (via.y + obstacle.y) / 2,
    }

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
      index.insert(via, expandBounds(getViaBounds(via), this.viaClearance))
    }

    for (const viaA of vias) {
      for (const viaB of index.query(getViaBounds(viaA))) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        if (viaB.order <= viaA.order) continue
        this.lastRunStats.exactCheckCount += 1

        const centerDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
        if (centerDistance <= POSITION_EPSILON) continue
        const gap = centerDistance - viaA.diameter / 2 - viaB.diameter / 2
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

  evaluate(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces, true)
  }

  /**
   * Evaluates the established trace/via DRC set used by the first repair
   * stage. Via-to-pad errors remain part of the normal complete evaluation and
   * are handled by the subsequent staged repair pass.
   */
  evaluateLegacy(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateInternal(traces, false)
  }

  private evaluateInternal(
    traces: SimplifiedPcbTraces,
    includeViaPadErrors: boolean,
  ): AutoroutingDrcResult {
    const { segments, vias } = this.collectDynamicGeometry(traces)
    const dynamicIndexesByLayer = this.buildDynamicIndexes(segments, vias)
    const detectedTraceErrors: AutoroutingDrcError[] = []
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

    if (includeViaPadErrors) {
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
    for (const error of detectedTraceErrors) {
      const errorId = String(error.pcb_trace_error_id)
      const existing = firstTraceErrorById.get(errorId)
      const actualClearance = Number(error.actual_clearance)
      if (!existing) {
        firstTraceErrorById.set(errorId, {
          ...error,
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
    const errors: AutoroutingDrcError[] = [...firstTraceErrorById.values()].map(
      (error) => ({
        ...error,
        center:
          typeof error.worst_contact_center === "object"
            ? (error.worst_contact_center as Point)
            : error.center,
        message:
          typeof error.worst_contact_message === "string"
            ? error.worst_contact_message
            : error.message,
        actual_clearance:
          typeof error.worst_actual_clearance === "number"
            ? error.worst_actual_clearance
            : error.actual_clearance,
      }),
    )
    errors.push(...detectedViaPadErrors)
    errors.push(...detectedViaErrors)
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
