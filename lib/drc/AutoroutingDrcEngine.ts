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
  type: "pcb_trace_error" | "pcb_via_clearance_error"
  error_type: "pcb_trace_error" | "pcb_via_clearance_error"
  message: string
  center?: Point
  pcb_center?: Point
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
  private readonly cellSize: number
  private readonly connMap?: ConnectivityMap
  private readonly canonicalNetByAlias = new Map<string, string>()
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
    this.connMap = options.connMap
    this.cellSize = options.spatialCellSize ?? this.getDefaultSpatialCellSize()

    if (!Number.isFinite(this.traceClearance) || this.traceClearance < 0) {
      throw new Error("traceClearance must be a non-negative finite number")
    }
    if (!Number.isFinite(this.viaClearance)) {
      throw new Error("viaClearance must be a finite number")
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
      (this.srj.minViaDiameter ?? 0.3) + this.traceClearance,
    )
  }

  private compileConnectionAliases() {
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
        if (alias) this.canonicalNetByAlias.set(alias, canonicalNet)
      }
      this.canonicalNetByAlias.set(canonicalNet, canonicalNet)
    }
  }

  private resolveNetId(id: string) {
    const connMapNetId = this.connMap?.getNetConnectedToId(id)
    if (connMapNetId) {
      return (
        this.canonicalNetByAlias.get(connMapNetId) ??
        this.canonicalNetByAlias.get(id) ??
        connMapNetId
      )
    }
    return this.canonicalNetByAlias.get(id) ?? id
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
        this.traceClearance,
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

  private obstacleSharesNet(segment: TraceSegment, obstacle: StaticObstacle) {
    return obstacle.connectedTo.some((connectedId) =>
      this.areConnected(segment.netId, connectedId),
    )
  }

  private checkTracePair(
    segmentA: TraceSegment,
    segmentB: TraceSegment,
    reportedErrorIds: Set<string>,
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
    const reverseId = `overlap_${segmentB.traceId}_${segmentA.traceId}`
    if (reportedErrorIds.has(forwardId) || reportedErrorIds.has(reverseId)) {
      return undefined
    }
    reportedErrorIds.add(forwardId)

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segmentA.traceId,
        `PCB trace ${segmentB.traceId}`,
        gap,
      ),
      pcb_trace_id: segmentA.traceId,
      pcb_trace_ids: [segmentA.traceId, segmentB.traceId],
      source_trace_id: "",
      pcb_trace_error_id: forwardId,
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
    reportedErrorIds: Set<string>,
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
    if (reportedErrorIds.has(errorId)) return undefined
    reportedErrorIds.add(errorId)

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segment.traceId,
        `pcb_via "${via.viaId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      pcb_trace_ids: [segment.traceId, via.traceId],
      pcb_via_trace_id: via.traceId,
      source_trace_id: "",
      pcb_trace_error_id: errorId,
      pcb_component_ids: [],
      pcb_port_ids: segment.pcbPortIds,
      center: getClosestPointBetweenSegmentAndPoint(segment, via),
    }
  }

  private checkTraceObstacle(
    segment: TraceSegment,
    obstacle: StaticObstacle,
    reportedErrorIds: Set<string>,
  ): AutoroutingDrcError | undefined {
    if (this.obstacleSharesNet(segment, obstacle)) return undefined
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
    if (reportedErrorIds.has(errorId)) return undefined
    reportedErrorIds.add(errorId)

    return {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      message: createTraceErrorMessage(
        segment.traceId,
        `${obstacle.obstacleType} "${obstacle.obstacleId}"`,
        gap,
      ),
      pcb_trace_id: segment.traceId,
      pcb_trace_ids: [segment.traceId],
      pcb_obstacle_id: obstacle.obstacleId,
      source_trace_id: "",
      pcb_trace_error_id: errorId,
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
          pcb_trace_ids: [viaA.traceId, viaB.traceId],
          pcb_via_trace_ids: [viaA.traceId, viaB.traceId],
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
    const { segments, vias } = this.collectDynamicGeometry(traces)
    const dynamicIndexesByLayer = this.buildDynamicIndexes(segments, vias)
    const errors: AutoroutingDrcError[] = []
    const reportedTraceErrorIds = new Set<string>()

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
            ? this.checkTracePair(segment, candidate, reportedTraceErrorIds)
            : this.checkTraceVia(segment, candidate, reportedTraceErrorIds)
        if (error) errors.push(error)
      }

      for (const obstacle of obstacleCandidates) {
        this.lastRunStats.broadPhaseCandidateCount += 1
        const error = this.checkTraceObstacle(
          segment,
          obstacle,
          reportedTraceErrorIds,
        )
        if (error) errors.push(error)
      }
    }

    errors.push(...this.checkViaPairs(vias))
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
