import { BaseSolver } from "../BaseSolver"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import { PREFERRED_VIA_TO_VIA_CLEARANCE, getDrcErrors } from "./getDrcErrors"
import { convertToCircuitJson } from "../utils/convertToCircuitJson"
import type { DrcEvaluator } from "./types"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../../utils/convertHdRouteToSimplifiedRoute"

type Point = { x: number; y: number }
type Bounds2D = { minX: number; minY: number; maxX: number; maxY: number }
type MutableRoute = HighDensityRoute & {
  route: Array<HighDensityRoute["route"][number]>
  vias: Array<HighDensityRoute["vias"][number]>
}
type ViaNode = {
  routeIndex: number
  rootConnectionName: string
  pointIndexes: number[]
  x: number
  y: number
  radius: number
  movable: boolean
}
type Segment = {
  routeIndex: number
  rootConnectionName: string
  startIndex: number
  endIndex: number
  start: Point
  end: Point
  z: number
  radius: number
}
type DrcSnapshot = {
  errors: Array<Record<string, unknown>>
  count: number
  issueScore: number
  traceRouteIndexById: Map<string, number>
}
type GlobalDrcForceImproveSolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  effort?: number
  drcEvaluator?: DrcEvaluator
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
}

const POSITION_EPSILON = 1e-6
const COORDINATE_EPSILON = 1e-3
const MAX_ERROR_MOVE = 0.14
const BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS = 2
const BROAD_FORCE_PASSES = 12
const BROAD_MAX_MOVE = 0.035
const BROAD_FALLBACK_SMALL_ROUTE_LIMIT = 120
const MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK = 192
const CLEARANCE_SLACK = 0.015
const VIA_PAIR_REPAIR_MAX_MOVE = 0.16
const TRACE_PAD_REPAIR_MAX_MOVE = 0.3
const PREFERRED_TRACE_TO_PAD_CLEARANCE = 0.16
const MIN_MAX_ITERATIONS = 48
const BASE_MAX_ITERATIONS_PER_EFFORT = 48
const MAX_ITERATIONS_PER_DRC_ERROR = 8 / 3
const LOW_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL = 1
const SMALL_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL = 2
const LARGE_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL = 8
const LARGE_DRC_COUNT_THRESHOLD = 20
const MAX_DRC_COUNT_PLATEAU_CHECKS = 2
const MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES = 2
const FAST_ERROR_FORCE_SCALES = [1, 1.75] as const
const DEEP_ERROR_FORCE_SCALES = [1, 1.75, -1] as const
const BROAD_SPATIAL_CELL_SIZE_MIN = 1

const getBaseMaxIterations = (effort: number) =>
  Math.max(
    MIN_MAX_ITERATIONS,
    Math.round(BASE_MAX_ITERATIONS_PER_EFFORT * Math.max(1, effort)),
  )

const getDrcScaledMaxIterations = (drcIssueCount: number, effort: number) =>
  Math.max(
    getBaseMaxIterations(effort),
    Math.ceil(
      drcIssueCount * MAX_ITERATIONS_PER_DRC_ERROR * Math.max(1, effort),
    ),
  )

const getRouteComplexityMinIterations = (
  routeCount: number,
  drcIssueCount: number,
) =>
  routeCount > BROAD_FALLBACK_SMALL_ROUTE_LIMIT && drcIssueCount > 0
    ? MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK
    : MIN_MAX_ITERATIONS

const getLargeBoardBroadFallbackCadence = (centeredDrcIssueCount: number) =>
  Math.max(16, Math.min(64, centeredDrcIssueCount * 2))

const getDrcCountImprovementCheckInterval = (initialDrcIssueCount: number) =>
  initialDrcIssueCount >= LARGE_DRC_COUNT_THRESHOLD
    ? LARGE_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL
    : initialDrcIssueCount <= 2
      ? LOW_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL
      : SMALL_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL

const cloneRoutes = (routes: HighDensityRoute[]): MutableRoute[] =>
  routes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point })),
    vias: route.vias.map((via) => ({ ...via })),
  }))

const areSameXY = (left: Point, right: Point) =>
  Math.abs(left.x - right.x) <= COORDINATE_EPSILON &&
  Math.abs(left.y - right.y) <= COORDINATE_EPSILON

const getRootConnectionName = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

const netAliasCache = new Map<string, readonly string[]>()
const netAliasSetCache = new Map<string, ReadonlySet<string>>()
const obstacleConnectedAliasCache = new WeakMap<
  SimpleRouteJson["obstacles"][number],
  ReadonlySet<string>
>()

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

const sharesNet = (left: string, right: string | undefined) => {
  if (!right) return false
  if (left === right) return true

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

const obstacleSharesNet = (
  rootConnectionName: string,
  obstacle: SimpleRouteJson["obstacles"][number],
) =>
  getNetAliases(rootConnectionName).some((alias) =>
    getObstacleConnectedAliasSet(obstacle).has(alias),
  )

const OBSTACLE_TRACE_ERROR_TYPES = [
  "pcb_smtpad",
  "pcb_plated_hole",
  "pcb_hole",
  "pcb_keepout",
]

const isTraceObstacleDrcError = (error: Record<string, unknown>) => {
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : ""
  return (
    message.includes("pcb_trace") &&
    OBSTACLE_TRACE_ERROR_TYPES.some((type) => message.includes(type))
  )
}

const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(value, maxValue))

const clampToBounds = (point: Point, bounds: SimpleRouteJson["bounds"]) => {
  point.x = clampValue(point.x, bounds.minX, bounds.maxX)
  point.y = clampValue(point.y, bounds.minY, bounds.maxY)
}

const expandBounds2d = (bounds: Bounds2D, margin: number): Bounds2D => ({
  minX: bounds.minX - margin,
  minY: bounds.minY - margin,
  maxX: bounds.maxX + margin,
  maxY: bounds.maxY + margin,
})

const getSpatialCellRange = (bounds: Bounds2D, cellSize: number) => ({
  minCellX: Math.floor(bounds.minX / cellSize),
  maxCellX: Math.floor(bounds.maxX / cellSize),
  minCellY: Math.floor(bounds.minY / cellSize),
  maxCellY: Math.floor(bounds.maxY / cellSize),
})

const getSpatialCellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

const createSpatialIndex = <T>(
  items: T[],
  getBounds: (item: T) => Bounds2D,
  cellSize: number,
) => {
  const index = new Map<string, number[]>()

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]
    if (!item) continue
    const cellRange = getSpatialCellRange(getBounds(item), cellSize)

    for (
      let cellX = cellRange.minCellX;
      cellX <= cellRange.maxCellX;
      cellX += 1
    ) {
      for (
        let cellY = cellRange.minCellY;
        cellY <= cellRange.maxCellY;
        cellY += 1
      ) {
        const key = getSpatialCellKey(cellX, cellY)
        const existing = index.get(key)
        if (existing) {
          existing.push(itemIndex)
        } else {
          index.set(key, [itemIndex])
        }
      }
    }
  }

  return index
}

const getSpatialCandidateIndexes = (
  spatialIndex: Map<string, number[]>,
  bounds: Bounds2D,
  cellSize: number,
) => {
  const indexes = new Set<number>()
  const cellRange = getSpatialCellRange(bounds, cellSize)

  for (
    let cellX = cellRange.minCellX;
    cellX <= cellRange.maxCellX;
    cellX += 1
  ) {
    for (
      let cellY = cellRange.minCellY;
      cellY <= cellRange.maxCellY;
      cellY += 1
    ) {
      const cellIndexes = spatialIndex.get(getSpatialCellKey(cellX, cellY))
      if (!cellIndexes) continue
      for (const index of cellIndexes) {
        indexes.add(index)
      }
    }
  }

  return [...indexes].sort((left, right) => left - right)
}

const createSimplifiedTraces = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): {
  traces: SimplifiedPcbTraces
  traceRouteIndexById: Map<string, number>
} => {
  const traces: SimplifiedPcbTraces = []
  const traceRouteIndexById = new Map<string, number>()

  for (const connection of srj.connections) {
    const hdRoutes = routes
      .map((route, routeIndex) => ({ route, routeIndex }))
      .filter(({ route }) => route.connectionName === connection.name)

    for (let i = 0; i < hdRoutes.length; i += 1) {
      const hdRoute = hdRoutes[i]
      if (!hdRoute) continue
      const traceId = `${connection.name}_${i}`

      traces.push({
        type: "pcb_trace",
        pcb_trace_id: traceId,
        connection_name:
          connection.netConnectionName ??
          connection.rootConnectionName ??
          connection.name,
        route: convertHdRouteToSimplifiedRoute(
          hdRoute.route.route,
          srj.layerCount,
          {
            traceThickness:
              hdRoute.route.traceThickness ??
              connection.nominalTraceWidth ??
              srj.nominalTraceWidth ??
              srj.minTraceWidth,
            viaDiameter: hdRoute.route.viaDiameter ?? srj.minViaDiameter,
            connectionPoints: connection.pointsToConnect,
          },
        ),
      })
      traceRouteIndexById.set(traceId, hdRoute.routeIndex)
    }
  }

  return { traces, traceRouteIndexById }
}

const getDrcErrorSeverity = (error: Record<string, unknown>) => {
  const message = typeof error.message === "string" ? error.message : ""
  const gapMatch = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
  const requiredMatch = message.match(/required: (-?\d+(?:\.\d+)?)mm/)
  if (gapMatch && requiredMatch) {
    const gap = Number.parseFloat(gapMatch[1]!)
    const required = Number.parseFloat(requiredMatch[1]!)
    if (Number.isFinite(gap) && Number.isFinite(required)) {
      return Math.max(0, required - gap)
    }
  }

  if (gapMatch) {
    const gap = Number.parseFloat(gapMatch[1]!)
    const required = RELAXED_DRC_OPTIONS.traceClearance ?? 0.1
    if (Number.isFinite(gap)) {
      return Math.max(0, required - gap)
    }
  }

  return 1
}

const getDrcIssueScore = (errors: Array<Record<string, unknown>>) =>
  errors.reduce((score, error) => score + getDrcErrorSeverity(error), 0)

export const getDrcSnapshot = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  drcEvaluator?: DrcEvaluator,
): DrcSnapshot => {
  const { traces, traceRouteIndexById } = createSimplifiedTraces(srj, routes)
  const drcResult = drcEvaluator?.({
    srj,
    routes,
    traces,
  })

  if (drcResult) {
    const errors = Array.isArray(drcResult) ? drcResult : drcResult.errors
    const errorsWithCenters = Array.isArray(drcResult)
      ? drcResult
      : (drcResult.errorsWithCenters ?? drcResult.errors)

    return {
      errors: errors as Array<Record<string, unknown>>,
      count: errors.length,
      issueScore: getDrcIssueScore(errors as Array<Record<string, unknown>>),
      traceRouteIndexById,
    }
  }

  const drc = getDrcErrors(
    convertToCircuitJson(srj, traces, srj.minTraceWidth, srj.minViaDiameter),
    RELAXED_DRC_OPTIONS,
  )

  return {
    errors:
      drc.errorsWithCenters.length > 0
        ? (drc.errorsWithCenters as unknown as Array<Record<string, unknown>>)
        : (drc.errors as unknown as Array<Record<string, unknown>>),
    count: drc.errors.length,
    issueScore: getDrcIssueScore(
      (drc.errorsWithCenters.length > 0
        ? drc.errorsWithCenters
        : drc.errors) as unknown as Array<Record<string, unknown>>,
    ),
    traceRouteIndexById,
  }
}

const collectViaNodes = (routes: MutableRoute[]): ViaNode[] => {
  const vias: ViaNode[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue
    const seenIndexes = new Set<number>()

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const current = route.route[index]
      const next = route.route[index + 1]
      if (!current || !next) continue
      if (current.z === next.z || !areSameXY(current, next)) continue

      const pointIndexes = [index, index + 1]
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }
      for (let cursor = index + 2; cursor < route.route.length; cursor += 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }

      const uniquePointIndexes = [...new Set(pointIndexes)]
      if (
        uniquePointIndexes.some((pointIndex) => seenIndexes.has(pointIndex))
      ) {
        continue
      }
      for (const pointIndex of uniquePointIndexes) {
        seenIndexes.add(pointIndex)
      }

      vias.push({
        routeIndex,
        rootConnectionName: getRootConnectionName(route),
        pointIndexes: uniquePointIndexes,
        x: current.x,
        y: current.y,
        radius: (route.viaDiameter ?? 0.3) / 2,
        movable:
          !uniquePointIndexes.includes(0) &&
          !uniquePointIndexes.includes(route.route.length - 1),
      })
    }
  }

  return vias
}

const collectSegments = (routes: MutableRoute[]): Segment[] => {
  const segments: Segment[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end) continue
      if (start.z !== end.z || areSameXY(start, end)) continue
      segments.push({
        routeIndex,
        rootConnectionName: getRootConnectionName(route),
        startIndex: index,
        endIndex: index + 1,
        start,
        end,
        z: start.z,
        radius: (route.traceThickness ?? 0.1) / 2,
      })
    }
  }

  return segments
}

const getViaBounds = (via: ViaNode): Bounds2D => ({
  minX: via.x,
  minY: via.y,
  maxX: via.x,
  maxY: via.y,
})

const getSegmentBounds = (segment: Segment): Bounds2D => ({
  minX: Math.min(segment.start.x, segment.end.x),
  minY: Math.min(segment.start.y, segment.end.y),
  maxX: Math.max(segment.start.x, segment.end.x),
  maxY: Math.max(segment.start.y, segment.end.y),
})

const getObstacleBounds = (
  obstacle: SimpleRouteJson["obstacles"][number],
): Bounds2D => ({
  minX: obstacle.center.x - obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const getBroadSpatialInteractionDistance = (
  srj: SimpleRouteJson,
  vias: ViaNode[],
  segments: Segment[],
) => {
  const maxViaRadius = vias.reduce(
    (currentMax, via) => Math.max(currentMax, via.radius),
    (srj.minViaDiameter ?? 0.3) / 2,
  )
  const maxSegmentRadius = segments.reduce(
    (currentMax, segment) => Math.max(currentMax, segment.radius),
    srj.minTraceWidth / 2,
  )
  const traceClearance =
    (RELAXED_DRC_OPTIONS.traceClearance ?? 0.1) + CLEARANCE_SLACK

  return Math.max(
    maxViaRadius * 2 + PREFERRED_VIA_TO_VIA_CLEARANCE + CLEARANCE_SLACK,
    maxViaRadius + maxSegmentRadius + traceClearance,
    maxSegmentRadius * 2 + traceClearance,
    maxSegmentRadius + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK,
    maxViaRadius + (srj.defaultObstacleMargin ?? 0.1) + CLEARANCE_SLACK,
  )
}

const pointToSegmentProjection = (point: Point, segment: Segment) => {
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared <= POSITION_EPSILON) {
    return { x: segment.start.x, y: segment.start.y, t: 0 }
  }

  const t = clampValue(
    ((point.x - segment.start.x) * segmentX +
      (point.y - segment.start.y) * segmentY) /
      lengthSquared,
    0,
    1,
  )

  return {
    x: segment.start.x + segmentX * t,
    y: segment.start.y + segmentY * t,
    t,
  }
}

const getPointToObstacleDistance = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const dx = Math.max(Math.abs(point.x - obstacle.center.x) - halfWidth, 0)
  const dy = Math.max(Math.abs(point.y - obstacle.center.y) - halfHeight, 0)
  return Math.hypot(dx, dy)
}

const getNearestObstacleNearPoint = (
  srj: SimpleRouteJson,
  point: Point,
  maxDistance = 0.6,
  predicate?: (obstacle: SimpleRouteJson["obstacles"][number]) => boolean,
) => {
  let nearestObstacle:
    | {
        obstacle: SimpleRouteJson["obstacles"][number]
        distance: number
      }
    | undefined

  for (const obstacle of srj.obstacles) {
    if (predicate && !predicate(obstacle)) continue
    const distance = getPointToObstacleDistance(point, obstacle)
    if (distance > maxDistance) continue
    if (!nearestObstacle || distance < nearestObstacle.distance) {
      nearestObstacle = {
        obstacle,
        distance,
      }
    }
  }

  return nearestObstacle?.obstacle
}

const getRectRepulsion = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
  requiredDistance: number,
) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const closestX = clampValue(
    point.x,
    obstacle.center.x - halfWidth,
    obstacle.center.x + halfWidth,
  )
  const closestY = clampValue(
    point.y,
    obstacle.center.y - halfHeight,
    obstacle.center.y + halfHeight,
  )
  let separationX = point.x - closestX
  let separationY = point.y - closestY
  let distance = Math.hypot(separationX, separationY)

  if (distance <= POSITION_EPSILON) {
    const dxToSide = halfWidth - Math.abs(point.x - obstacle.center.x)
    const dyToSide = halfHeight - Math.abs(point.y - obstacle.center.y)
    if (dxToSide < dyToSide) {
      separationX = point.x >= obstacle.center.x ? 1 : -1
      separationY = 0
      distance = 0
    } else {
      separationX = 0
      separationY = point.y >= obstacle.center.y ? 1 : -1
      distance = 0
    }
  }

  const penetration = requiredDistance - distance
  if (penetration <= 0) return undefined

  const directionLength = Math.hypot(separationX, separationY)
  return {
    direction: {
      x: directionLength > POSITION_EPSILON ? separationX / directionLength : 1,
      y: directionLength > POSITION_EPSILON ? separationY / directionLength : 0,
    },
    penetration,
  }
}

const getRepulsionPointForError = (
  srj: SimpleRouteJson,
  error: Record<string, unknown>,
  center: Point,
  obstacleFilter?: (obstacle: SimpleRouteJson["obstacles"][number]) => boolean,
) => {
  const message = error.message
  if (typeof message !== "string" || !message.includes("pcb_")) {
    return center
  }

  return (
    getNearestObstacleNearPoint(srj, center, 0.6, obstacleFilter)?.center ??
    center
  )
}

const getCoincidentPointIndexes = (route: MutableRoute, pointIndex: number) => {
  const point = route.route[pointIndex]
  if (!point) return []
  const pointIndexes = [pointIndex]

  for (let cursor = pointIndex - 1; cursor >= 0; cursor -= 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }
  for (let cursor = pointIndex + 1; cursor < route.route.length; cursor += 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }

  return [...new Set(pointIndexes)]
}

const getMovableCoincidentPointIndexes = (
  route: MutableRoute,
  pointIndex: number,
) => {
  if (pointIndex <= 0 || pointIndex >= route.route.length - 1) return undefined

  const pointIndexes = getCoincidentPointIndexes(route, pointIndex)
  if (
    pointIndexes.includes(0) ||
    pointIndexes.includes(route.route.length - 1)
  ) {
    return undefined
  }

  return pointIndexes
}

const moveRoutePoint = (
  routes: MutableRoute[],
  routeIndex: number,
  pointIndex: number,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  const route = routes[routeIndex]
  if (!route) return false

  const pointIndexes = getMovableCoincidentPointIndexes(route, pointIndex)
  if (!pointIndexes) return false

  let changed = false
  for (const candidateIndex of pointIndexes) {
    const point = route.route[candidateIndex]
    if (!point) continue
    point.x += dx
    point.y += dy
    clampToBounds(point, bounds)
    changed = true
  }

  return changed
}

const moveSegmentByTranslation = (
  routes: MutableRoute[],
  segment: Segment,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  const route = routes[segment.routeIndex]
  if (!route) return false

  const startIndexes = getMovableCoincidentPointIndexes(
    route,
    segment.startIndex,
  )
  const endIndexes = getMovableCoincidentPointIndexes(route, segment.endIndex)
  if (!startIndexes || !endIndexes) return false

  let changed = false
  for (const pointIndex of [...new Set([...startIndexes, ...endIndexes])]) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x += dx
    point.y += dy
    clampToBounds(point, bounds)
    changed = true
  }

  return changed
}

const moveRoutePointIndexesByTranslation = (
  route: MutableRoute,
  pointIndexes: number[],
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  let changed = false
  for (const pointIndex of pointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x += dx
    point.y += dy
    clampToBounds(point, bounds)
    changed = true
  }

  return changed
}

const segmentVectorsAreCollinear = (
  left: Point,
  middle: Point,
  right: Point,
) => {
  const leftX = middle.x - left.x
  const leftY = middle.y - left.y
  const rightX = right.x - middle.x
  const rightY = right.y - middle.y
  return Math.abs(leftX * rightY - leftY * rightX) <= COORDINATE_EPSILON
}

const pointIsOnSegmentLine = (
  point: HighDensityRoute["route"][number],
  segment: Segment,
) => {
  if (point.z !== segment.z) return false
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const pointX = point.x - segment.start.x
  const pointY = point.y - segment.start.y
  return Math.abs(segmentX * pointY - segmentY * pointX) <= COORDINATE_EPSILON
}

const getCollinearRunPointIndexes = (route: MutableRoute, segment: Segment) => {
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const axisLineTolerance = Math.max(
    COORDINATE_EPSILON,
    (route.traceThickness ?? 0.1) * 0.12,
  )
  const isHorizontal = Math.abs(segmentY) <= axisLineTolerance
  const isVertical = Math.abs(segmentX) <= axisLineTolerance
  let startIndex = segment.startIndex
  let endIndex = segment.endIndex

  if (isHorizontal || isVertical) {
    const lineCoordinate = isHorizontal
      ? (segment.start.y + segment.end.y) / 2
      : (segment.start.x + segment.end.x) / 2
    while (startIndex > 0) {
      const previousPoint = route.route[startIndex - 1]
      if (
        !previousPoint ||
        previousPoint.z !== segment.z ||
        Math.abs(
          (isHorizontal ? previousPoint.y : previousPoint.x) - lineCoordinate,
        ) > axisLineTolerance
      ) {
        break
      }
      startIndex -= 1
    }

    while (endIndex < route.route.length - 1) {
      const nextPoint = route.route[endIndex + 1]
      if (
        !nextPoint ||
        nextPoint.z !== segment.z ||
        Math.abs((isHorizontal ? nextPoint.y : nextPoint.x) - lineCoordinate) >
          axisLineTolerance
      ) {
        break
      }
      endIndex += 1
    }

    return Array.from(
      { length: endIndex - startIndex + 1 },
      (_, index) => startIndex + index,
    )
  }

  while (startIndex > 0) {
    const previousPoint = route.route[startIndex - 1]
    const currentPoint = route.route[startIndex]
    const nextPoint = route.route[startIndex + 1]
    if (
      !previousPoint ||
      !currentPoint ||
      !nextPoint ||
      previousPoint.z !== segment.z ||
      !pointIsOnSegmentLine(previousPoint, segment) ||
      !segmentVectorsAreCollinear(previousPoint, currentPoint, nextPoint)
    ) {
      break
    }
    startIndex -= 1
  }

  while (endIndex < route.route.length - 1) {
    const previousPoint = route.route[endIndex - 1]
    const currentPoint = route.route[endIndex]
    const nextPoint = route.route[endIndex + 1]
    if (
      !previousPoint ||
      !currentPoint ||
      !nextPoint ||
      nextPoint.z !== segment.z ||
      !pointIsOnSegmentLine(nextPoint, segment) ||
      !segmentVectorsAreCollinear(previousPoint, currentPoint, nextPoint)
    ) {
      break
    }
    endIndex += 1
  }

  return Array.from(
    { length: endIndex - startIndex + 1 },
    (_, index) => startIndex + index,
  )
}

const getMovableCollinearRunPointIndexes = (
  route: MutableRoute,
  segment: Segment,
) => {
  const runPointIndexes = getCollinearRunPointIndexes(route, segment)
  if (runPointIndexes.length <= 2) return undefined

  const movablePointIndexes: number[] = []
  for (const pointIndex of runPointIndexes) {
    const coincidentIndexes = getMovableCoincidentPointIndexes(
      route,
      pointIndex,
    )
    if (!coincidentIndexes) return undefined
    movablePointIndexes.push(...coincidentIndexes)
  }

  return [...new Set(movablePointIndexes)]
}

const moveCollinearSegmentRunByTranslation = (
  routes: MutableRoute[],
  segment: Segment,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  const route = routes[segment.routeIndex]
  if (!route) return false

  const movablePointIndexes = getMovableCollinearRunPointIndexes(route, segment)
  if (!movablePointIndexes) return false

  return moveRoutePointIndexesByTranslation(
    route,
    movablePointIndexes,
    dx,
    dy,
    bounds,
  )
}

const getDirectionAwayFromPoint = (segment: Segment, point: Point) => {
  const projection = pointToSegmentProjection(point, segment)
  const separationX = projection.x - point.x
  const separationY = projection.y - point.y
  const distance = Math.hypot(separationX, separationY)
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const segmentLength = Math.hypot(segmentX, segmentY)
  const fallbackSign = segment.routeIndex % 2 === 0 ? 1 : -1

  return {
    projection,
    direction:
      distance > POSITION_EPSILON
        ? {
            x: separationX / distance,
            y: separationY / distance,
          }
        : segmentLength > POSITION_EPSILON
          ? {
              x: (-segmentY / segmentLength) * fallbackSign,
              y: (segmentX / segmentLength) * fallbackSign,
            }
          : { x: 1, y: 0 },
  }
}

const insertDetourPointAwayFromPoint = (
  routes: MutableRoute[],
  segment: Segment,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
  scale: number,
) => {
  const route = routes[segment.routeIndex]
  if (!route) return false

  const { projection, direction } = getDirectionAwayFromPoint(segment, point)
  const detourPoint = {
    ...route.route[segment.startIndex]!,
    x: projection.x + direction.x * MAX_ERROR_MOVE * scale,
    y: projection.y + direction.y * MAX_ERROR_MOVE * scale,
  }
  clampToBounds(detourPoint, bounds)
  route.route.splice(segment.endIndex, 0, detourPoint)
  return true
}

const moveVia = (
  routes: MutableRoute[],
  via: ViaNode,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  if (!via.movable) return false
  const route = routes[via.routeIndex]
  if (!route) return false

  via.x += dx
  via.y += dy
  clampToBounds(via, bounds)
  for (const pointIndex of via.pointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x = via.x
    point.y = via.y
  }
  return true
}

const moveSegmentAwayFromPoint = (
  routes: MutableRoute[],
  segment: Segment,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
  scale = 1,
) => {
  const { projection, direction } = getDirectionAwayFromPoint(segment, point)
  const move = MAX_ERROR_MOVE * scale
  const startWeight = 1 - projection.t
  const endWeight = projection.t

  const movedStart = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.startIndex,
    direction.x * move * startWeight,
    direction.y * move * startWeight,
    bounds,
  )
  const movedEnd = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.endIndex,
    direction.x * move * endWeight,
    direction.y * move * endWeight,
    bounds,
  )

  if (movedStart || movedEnd) {
    return true
  }

  return insertDetourPointAwayFromPoint(routes, segment, point, bounds, scale)
}

const moveSegmentAwayFromObstacle = (
  routes: MutableRoute[],
  segment: Segment,
  obstacle: SimpleRouteJson["obstacles"][number],
  bounds: SimpleRouteJson["bounds"],
  scale = 1,
) => {
  const requiredDistance =
    segment.radius + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK
  const repulsion = getSegmentRectRepulsion(segment, obstacle, requiredDistance)
  if (!repulsion) return false

  const move = Math.min(
    TRACE_PAD_REPAIR_MAX_MOVE * Math.abs(scale),
    repulsion.penetration,
  )
  const dx = repulsion.direction.x * move
  const dy = repulsion.direction.y * move
  const movedSegment =
    moveCollinearSegmentRunByTranslation(routes, segment, dx, dy, bounds) ||
    moveSegmentByTranslation(routes, segment, dx, dy, bounds)
  if (movedSegment) return true

  const route = routes[segment.routeIndex]
  if (!route) return false
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const detourPoints =
    Math.abs(repulsion.direction.y) >= Math.abs(repulsion.direction.x)
      ? [
          {
            ...route.route[segment.startIndex]!,
            x: obstacle.center.x - halfWidth - requiredDistance,
            y:
              obstacle.center.y +
              repulsion.direction.y * (halfHeight + requiredDistance),
          },
          {
            ...route.route[segment.startIndex]!,
            x: obstacle.center.x + halfWidth + requiredDistance,
            y:
              obstacle.center.y +
              repulsion.direction.y * (halfHeight + requiredDistance),
          },
        ]
      : [
          {
            ...route.route[segment.startIndex]!,
            x:
              obstacle.center.x +
              repulsion.direction.x * (halfWidth + requiredDistance),
            y: obstacle.center.y - halfHeight - requiredDistance,
          },
          {
            ...route.route[segment.startIndex]!,
            x:
              obstacle.center.x +
              repulsion.direction.x * (halfWidth + requiredDistance),
            y: obstacle.center.y + halfHeight + requiredDistance,
          },
        ]

  const orderedDetourPoints = detourPoints
    .map((point) => ({
      point,
      t: pointToSegmentProjection(point, segment).t,
    }))
    .sort((a, b) => a.t - b.t)
    .map(({ point }) => {
      clampToBounds(point, bounds)
      return point
    })

  route.route.splice(segment.endIndex, 0, ...orderedDetourPoints)
  return true
}

const getNearestSegment = (
  segments: Segment[],
  point: Point,
  routeIndex?: number,
) => {
  let best:
    | {
        segment: Segment
        distance: number
      }
    | undefined

  for (const segment of segments) {
    if (routeIndex !== undefined && segment.routeIndex !== routeIndex) continue
    const projection = pointToSegmentProjection(point, segment)
    const distance = Math.hypot(projection.x - point.x, projection.y - point.y)
    if (!best || distance < best.distance) {
      best = { segment, distance }
    }
  }

  return best?.segment
}

const getNearestVia = (vias: ViaNode[], point: Point) => {
  let best:
    | {
        via: ViaNode
        distance: number
      }
    | undefined

  for (const via of vias) {
    const distance = Math.hypot(via.x - point.x, via.y - point.y)
    if (!best || distance < best.distance) {
      best = { via, distance }
    }
  }

  return best?.via
}

const getNearestViaPair = (vias: ViaNode[], point: Point) => {
  const nearest = vias
    .map((via) => ({
      via,
      distance: Math.hypot(via.x - point.x, via.y - point.y),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2)
    .map(({ via }) => via)

  return nearest.length === 2 ? (nearest as [ViaNode, ViaNode]) : undefined
}

const moveViaAwayFromPoint = (
  routes: MutableRoute[],
  via: ViaNode,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
) => {
  const separationX = via.x - point.x
  const separationY = via.y - point.y
  const distance = Math.hypot(separationX, separationY)
  const directionX = distance > POSITION_EPSILON ? separationX / distance : 1
  const directionY = distance > POSITION_EPSILON ? separationY / distance : 0

  return moveVia(
    routes,
    via,
    directionX * MAX_ERROR_MOVE,
    directionY * MAX_ERROR_MOVE,
    bounds,
  )
}

const getSegmentDistanceCandidates = (left: Segment, right: Segment) => {
  const leftStartProjection = pointToSegmentProjection(left.start, right)
  const leftEndProjection = pointToSegmentProjection(left.end, right)
  const rightStartProjection = pointToSegmentProjection(right.start, left)
  const rightEndProjection = pointToSegmentProjection(right.end, left)

  return [
    {
      leftT: 0,
      rightT: leftStartProjection.t,
      leftPoint: left.start,
      rightPoint: leftStartProjection,
    },
    {
      leftT: 1,
      rightT: leftEndProjection.t,
      leftPoint: left.end,
      rightPoint: leftEndProjection,
    },
    {
      leftT: rightStartProjection.t,
      rightT: 0,
      leftPoint: rightStartProjection,
      rightPoint: right.start,
    },
    {
      leftT: rightEndProjection.t,
      rightT: 1,
      leftPoint: rightEndProjection,
      rightPoint: right.end,
    },
  ].sort((a, b) => {
    const aDistance = Math.hypot(
      a.leftPoint.x - a.rightPoint.x,
      a.leftPoint.y - a.rightPoint.y,
    )
    const bDistance = Math.hypot(
      b.leftPoint.x - b.rightPoint.x,
      b.leftPoint.y - b.rightPoint.y,
    )
    return aDistance - bDistance
  })
}

const moveSegmentByDistribution = (
  routes: MutableRoute[],
  segment: Segment,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
  t: number,
) => {
  const clampedT = clampValue(t, 0, 1)
  const startWeight = 1 - clampedT
  const endWeight = clampedT
  const movedStart = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.startIndex,
    dx * startWeight,
    dy * startWeight,
    bounds,
  )
  const movedEnd = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.endIndex,
    dx * endWeight,
    dy * endWeight,
    bounds,
  )

  return movedStart || movedEnd
}

const pushViaViaPair = (
  routes: MutableRoute[],
  left: ViaNode,
  right: ViaNode,
  bounds: SimpleRouteJson["bounds"],
  maxMove = BROAD_MAX_MOVE,
) => {
  const requiredDistance =
    left.radius +
    right.radius +
    PREFERRED_VIA_TO_VIA_CLEARANCE +
    CLEARANCE_SLACK
  const separationX = left.x - right.x
  const separationY = left.y - right.y
  const distance = Math.hypot(separationX, separationY)
  const penetration = requiredDistance - distance
  if (penetration <= 0) return false

  const fallbackAngle = (left.routeIndex * 97 + right.routeIndex * 13) * 1.618
  const directionX =
    distance > POSITION_EPSILON
      ? separationX / distance
      : Math.cos(fallbackAngle)
  const directionY =
    distance > POSITION_EPSILON
      ? separationY / distance
      : Math.sin(fallbackAngle)
  const movableCount = Number(left.movable) + Number(right.movable)
  if (movableCount === 0) return false

  const move = Math.min(maxMove, penetration / movableCount)
  const movedLeft = moveVia(
    routes,
    left,
    directionX * move,
    directionY * move,
    bounds,
  )
  const movedRight = moveVia(
    routes,
    right,
    -directionX * move,
    -directionY * move,
    bounds,
  )
  return movedLeft || movedRight
}

const pushViaSegmentPair = (
  routes: MutableRoute[],
  via: ViaNode,
  segment: Segment,
  bounds: SimpleRouteJson["bounds"],
  maxMove = BROAD_MAX_MOVE,
  moveDivisor = 2,
) => {
  if (sharesNet(via.rootConnectionName, segment.rootConnectionName))
    return false

  const projection = pointToSegmentProjection(via, segment)
  const separationX = via.x - projection.x
  const separationY = via.y - projection.y
  const distance = Math.hypot(separationX, separationY)
  const requiredDistance =
    via.radius +
    segment.radius +
    (RELAXED_DRC_OPTIONS.traceClearance ?? 0.1) +
    CLEARANCE_SLACK
  const penetration = requiredDistance - distance
  if (penetration <= 0) return false

  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const segmentLength = Math.hypot(segmentX, segmentY)
  const fallbackSign = via.routeIndex % 2 === 0 ? 1 : -1
  const directionX =
    distance > POSITION_EPSILON
      ? separationX / distance
      : segmentLength > POSITION_EPSILON
        ? (-segmentY / segmentLength) * fallbackSign
        : 1
  const directionY =
    distance > POSITION_EPSILON
      ? separationY / distance
      : segmentLength > POSITION_EPSILON
        ? (segmentX / segmentLength) * fallbackSign
        : 0
  const move = Math.min(maxMove, penetration / moveDivisor)
  const movedVia = moveVia(
    routes,
    via,
    directionX * move,
    directionY * move,
    bounds,
  )
  const movedSegment = moveSegmentByDistribution(
    routes,
    segment,
    -directionX * move,
    -directionY * move,
    bounds,
    projection.t,
  )
  return movedVia || movedSegment
}

const pushSegmentSegmentPair = (
  routes: MutableRoute[],
  left: Segment,
  right: Segment,
  bounds: SimpleRouteJson["bounds"],
) => {
  if (
    left.z !== right.z ||
    sharesNet(left.rootConnectionName, right.rootConnectionName)
  ) {
    return false
  }

  const [candidate] = getSegmentDistanceCandidates(left, right)
  if (!candidate) return false

  const separationX = candidate.leftPoint.x - candidate.rightPoint.x
  const separationY = candidate.leftPoint.y - candidate.rightPoint.y
  const distance = Math.hypot(separationX, separationY)
  const requiredDistance =
    left.radius +
    right.radius +
    (RELAXED_DRC_OPTIONS.traceClearance ?? 0.1) +
    CLEARANCE_SLACK
  const penetration = requiredDistance - distance
  if (penetration <= 0) return false

  const leftVectorX = left.end.x - left.start.x
  const leftVectorY = left.end.y - left.start.y
  const fallbackLength = Math.hypot(leftVectorX, leftVectorY)
  const fallbackSign = (left.routeIndex + right.routeIndex) % 2 === 0 ? 1 : -1
  const directionX =
    distance > POSITION_EPSILON
      ? separationX / distance
      : fallbackLength > POSITION_EPSILON
        ? (-leftVectorY / fallbackLength) * fallbackSign
        : 1
  const directionY =
    distance > POSITION_EPSILON
      ? separationY / distance
      : fallbackLength > POSITION_EPSILON
        ? (leftVectorX / fallbackLength) * fallbackSign
        : 0
  const move = Math.min(BROAD_MAX_MOVE, penetration / 2)
  const movedLeft = moveSegmentByDistribution(
    routes,
    left,
    directionX * move,
    directionY * move,
    bounds,
    candidate.leftT,
  )
  const movedRight = moveSegmentByDistribution(
    routes,
    right,
    -directionX * move,
    -directionY * move,
    bounds,
    candidate.rightT,
  )
  return movedLeft || movedRight
}

const obstacleAppliesToSegment = (
  obstacle: SimpleRouteJson["obstacles"][number],
  segment: Segment,
) => {
  if (obstacle.zLayers?.includes(segment.z)) return true
  if (segment.z === 0 && obstacle.layers.includes("top")) return true
  if (segment.z === 1 && obstacle.layers.includes("bottom")) return true
  return obstacle.layers.length === 0
}

const getSegmentRectRepulsion = (
  segment: Segment,
  obstacle: SimpleRouteJson["obstacles"][number],
  requiredDistance: number,
) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const obstacleCorners = [
    {
      x: obstacle.center.x - halfWidth,
      y: obstacle.center.y - halfHeight,
    },
    {
      x: obstacle.center.x + halfWidth,
      y: obstacle.center.y - halfHeight,
    },
    {
      x: obstacle.center.x + halfWidth,
      y: obstacle.center.y + halfHeight,
    },
    {
      x: obstacle.center.x - halfWidth,
      y: obstacle.center.y + halfHeight,
    },
  ]
  const projectedCandidates = [obstacle.center, ...obstacleCorners].map(
    (point) => pointToSegmentProjection(point, segment),
  )
  const candidates = [
    { point: segment.start, t: 0 },
    { point: segment.end, t: 1 },
    {
      point: {
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      },
      t: 0.5,
    },
    ...projectedCandidates.map((projection) => ({
      point: { x: projection.x, y: projection.y },
      t: projection.t,
    })),
  ]

  let best:
    | {
        direction: Point
        penetration: number
        normality: number
        t: number
      }
    | undefined

  const segmentLength = Math.hypot(
    segment.end.x - segment.start.x,
    segment.end.y - segment.start.y,
  )
  for (const candidate of candidates) {
    const repulsion = getRectRepulsion(
      candidate.point,
      obstacle,
      requiredDistance,
    )
    if (!repulsion) continue
    const normality =
      segmentLength > POSITION_EPSILON
        ? Math.abs(
            ((segment.end.x - segment.start.x) * repulsion.direction.y -
              (segment.end.y - segment.start.y) * repulsion.direction.x) /
              segmentLength,
          )
        : 0
    if (
      !best ||
      repulsion.penetration > best.penetration + POSITION_EPSILON ||
      (Math.abs(repulsion.penetration - best.penetration) <= POSITION_EPSILON &&
        normality > best.normality)
    ) {
      best = {
        ...repulsion,
        normality,
        t: candidate.t,
      }
    }
  }

  return best
}

const pushMovablesAwayFromObstacles = (
  srj: SimpleRouteJson,
  routes: MutableRoute[],
  vias: ViaNode[],
  segments: Segment[],
  viaSpatialIndex: Map<string, number[]>,
  segmentSpatialIndex: Map<string, number[]>,
  spatialCellSize: number,
) => {
  let changed = false
  const requiredTraceObstacleDistance =
    srj.minTraceWidth / 2 + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK
  const requiredViaObstacleDistance =
    (srj.minViaDiameter ?? 0.3) / 2 +
    (srj.defaultObstacleMargin ?? 0.1) +
    CLEARANCE_SLACK

  for (const obstacle of srj.obstacles) {
    if (obstacle.isCopperPour) continue
    const obstacleBounds = getObstacleBounds(obstacle)

    const nearbyViaIndexes = getSpatialCandidateIndexes(
      viaSpatialIndex,
      expandBounds2d(obstacleBounds, requiredViaObstacleDistance),
      spatialCellSize,
    )
    for (const viaIndex of nearbyViaIndexes) {
      const via = vias[viaIndex]
      if (!via) continue
      if (obstacleSharesNet(via.rootConnectionName, obstacle)) continue
      const repulsion = getRectRepulsion(
        via,
        obstacle,
        requiredViaObstacleDistance,
      )
      if (!repulsion) continue
      const move = Math.min(BROAD_MAX_MOVE, repulsion.penetration)
      changed =
        moveVia(
          routes,
          via,
          repulsion.direction.x * move,
          repulsion.direction.y * move,
          srj.bounds,
        ) || changed
    }

    const nearbySegmentIndexes = getSpatialCandidateIndexes(
      segmentSpatialIndex,
      expandBounds2d(obstacleBounds, requiredTraceObstacleDistance),
      spatialCellSize,
    )
    for (const segmentIndex of nearbySegmentIndexes) {
      const segment = segments[segmentIndex]
      if (!segment) continue
      if (
        obstacleSharesNet(segment.rootConnectionName, obstacle) ||
        !obstacleAppliesToSegment(obstacle, segment)
      ) {
        continue
      }
      const repulsion = getSegmentRectRepulsion(
        segment,
        obstacle,
        requiredTraceObstacleDistance,
      )
      if (!repulsion) continue
      const move = Math.min(BROAD_MAX_MOVE, repulsion.penetration)
      changed =
        moveSegmentByDistribution(
          routes,
          segment,
          repulsion.direction.x * move,
          repulsion.direction.y * move,
          srj.bounds,
          repulsion.t,
        ) || changed
    }
  }

  return changed
}

const applyBroadRepulsionPass = (
  srj: SimpleRouteJson,
  routes: MutableRoute[],
) => {
  let changed = false
  const vias = collectViaNodes(routes)
  const segments = collectSegments(routes)
  const spatialInteractionDistance = getBroadSpatialInteractionDistance(
    srj,
    vias,
    segments,
  )
  const spatialCellSize = Math.max(
    BROAD_SPATIAL_CELL_SIZE_MIN,
    spatialInteractionDistance * 2,
  )
  const viaSpatialIndex = createSpatialIndex(
    vias,
    getViaBounds,
    spatialCellSize,
  )
  const segmentSpatialIndex = createSpatialIndex(
    segments,
    getSegmentBounds,
    spatialCellSize,
  )

  for (let leftIndex = 0; leftIndex < vias.length; leftIndex += 1) {
    const left = vias[leftIndex]
    if (!left) continue
    const nearbyViaIndexes = getSpatialCandidateIndexes(
      viaSpatialIndex,
      expandBounds2d(getViaBounds(left), spatialInteractionDistance),
      spatialCellSize,
    )
    for (const rightIndex of nearbyViaIndexes) {
      if (rightIndex <= leftIndex) continue
      const right = vias[rightIndex]
      if (!right) continue
      changed = pushViaViaPair(routes, left, right, srj.bounds) || changed
    }
  }

  for (let viaIndex = 0; viaIndex < vias.length; viaIndex += 1) {
    const via = vias[viaIndex]
    if (!via) continue
    const nearbySegmentIndexes = getSpatialCandidateIndexes(
      segmentSpatialIndex,
      expandBounds2d(getViaBounds(via), spatialInteractionDistance),
      spatialCellSize,
    )
    for (const segmentIndex of nearbySegmentIndexes) {
      const segment = segments[segmentIndex]
      if (!segment) continue
      changed = pushViaSegmentPair(routes, via, segment, srj.bounds) || changed
    }
  }

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex]
    if (!left) continue
    const nearbySegmentIndexes = getSpatialCandidateIndexes(
      segmentSpatialIndex,
      expandBounds2d(getSegmentBounds(left), spatialInteractionDistance),
      spatialCellSize,
    )
    for (const rightIndex of nearbySegmentIndexes) {
      if (rightIndex <= leftIndex) continue
      const right = segments[rightIndex]
      if (!right) continue
      changed =
        pushSegmentSegmentPair(routes, left, right, srj.bounds) || changed
    }
  }

  return (
    pushMovablesAwayFromObstacles(
      srj,
      routes,
      vias,
      segments,
      viaSpatialIndex,
      segmentSpatialIndex,
      spatialCellSize,
    ) || changed
  )
}

const applyBroadRepulsionForces = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  effort: number,
) => {
  const mutableRoutes = cloneRoutes(routes)
  const maxPasses = Math.max(
    2,
    Math.round(BROAD_FORCE_PASSES * Math.max(1, effort)),
  )
  let changed = false

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const passChanged = applyBroadRepulsionPass(srj, mutableRoutes)
    if (!passChanged) break
    changed = true
  }

  return changed ? materializeRoutes(mutableRoutes) : routes
}

const deriveVias = (route: MutableRoute): MutableRoute["vias"] => {
  const vias: MutableRoute["vias"] = []
  for (let index = 0; index < route.route.length - 1; index += 1) {
    const current = route.route[index]
    const next = route.route[index + 1]
    if (!current || !next) continue
    if (current.z === next.z || !areSameXY(current, next)) continue

    const via = {
      x: Number(current.x.toFixed(3)),
      y: Number(current.y.toFixed(3)),
    }
    const previousVia = vias.at(-1)
    if (previousVia && areSameXY(previousVia, via)) continue
    vias.push(via)
  }
  return vias
}

const materializeRoutes = (routes: MutableRoute[]): HighDensityRoute[] =>
  routes.map((route) => ({
    ...route,
    vias: deriveVias(route),
  }))

const parseTraceRouteIndex = (error: Record<string, unknown>) => {
  const traceId = error.pcb_trace_id
  if (typeof traceId !== "string") return undefined
  const match = traceId.match(/^trace_(\d+)/)
  return match ? Number.parseInt(match[1]!, 10) : undefined
}

const getErrorCenter = (error: Record<string, unknown>): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const maybeCenter = center as Record<string, unknown>
  return typeof maybeCenter.x === "number" && typeof maybeCenter.y === "number"
    ? { x: maybeCenter.x, y: maybeCenter.y }
    : undefined
}

const getCenteredErrors = (errors: Array<Record<string, unknown>>) =>
  errors.filter((error) => Boolean(getErrorCenter(error)))

const isViaDrcError = (error: Record<string, unknown>) =>
  Array.isArray(error.pcb_via_ids) ||
  (typeof error.pcb_error_id === "string" &&
    (error.pcb_error_id.startsWith("same_net_vias_close_") ||
      error.pcb_error_id.startsWith("different_net_vias_close_")))

const getViaDrcIssueCount = (snapshot: DrcSnapshot) =>
  snapshot.errors.filter(isViaDrcError).length

const getForceScalesForEffort = (effort: number) =>
  effort >= 2 ? DEEP_ERROR_FORCE_SCALES : FAST_ERROR_FORCE_SCALES

const getMaxTargetedCandidateAttemptsForEffort = (effort: number) =>
  Math.max(
    1,
    Math.round(BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS * Math.max(1, effort)),
  )

const getTraceRouteIndexForError = (
  error: Record<string, unknown>,
  traceRouteIndexById: Map<string, number>,
) => {
  const traceId = error.pcb_trace_id
  return typeof traceId === "string"
    ? (traceRouteIndexById.get(traceId) ?? parseTraceRouteIndex(error))
    : parseTraceRouteIndex(error)
}

const isBetterDrcSnapshot = (
  candidateSnapshot: DrcSnapshot,
  candidateViaIssueCount: number,
  bestIssueCount: number,
  bestIssueScore: number,
  bestViaIssueCount: number,
) =>
  candidateSnapshot.count < bestIssueCount ||
  (candidateSnapshot.count === bestIssueCount &&
    candidateSnapshot.issueScore < bestIssueScore) ||
  (candidateSnapshot.count === bestIssueCount &&
    candidateViaIssueCount < bestViaIssueCount)

const applyDrcErrorForces = (
  srj: SimpleRouteJson,
  routes: MutableRoute[],
  errors: Array<Record<string, unknown>>,
  traceRouteIndexById: Map<string, number>,
  scale: number,
) => {
  let changed = false
  const vias = collectViaNodes(routes)
  const segments = collectSegments(routes)

  for (const error of errors) {
    const center = getErrorCenter(error)
    if (!center) continue
    let repulsionPoint = center

    const viaIds = error.pcb_via_ids
    if (Array.isArray(viaIds) && viaIds.length > 0) {
      repulsionPoint = getRepulsionPointForError(srj, error, center)
      const nearestViaPair = getNearestViaPair(vias, center)
      if (nearestViaPair) {
        changed =
          pushViaViaPair(
            routes,
            nearestViaPair[0],
            nearestViaPair[1],
            srj.bounds,
            VIA_PAIR_REPAIR_MAX_MOVE * Math.abs(scale),
          ) || changed
      } else {
        const nearestVia = getNearestVia(vias, center)
        if (nearestVia) {
          changed =
            moveViaAwayFromPoint(
              routes,
              nearestVia,
              repulsionPoint,
              srj.bounds,
            ) || changed
        }
      }
      continue
    }

    const traceId = error.pcb_trace_id
    const routeIndex = getTraceRouteIndexForError(error, traceRouteIndexById)
    const nearestSegment = getNearestSegment(segments, center, routeIndex)
    if (nearestSegment) {
      const isObstacleError = isTraceObstacleDrcError(error)
      const nearestObstacle = isObstacleError
        ? getNearestObstacleNearPoint(
            srj,
            center,
            0.6,
            (obstacle) =>
              !obstacleSharesNet(nearestSegment.rootConnectionName, obstacle) &&
              obstacleAppliesToSegment(obstacle, nearestSegment),
          )
        : getNearestObstacleNearPoint(srj, center)
      if (isObstacleError && !nearestObstacle) {
        continue
      }
      repulsionPoint = isObstacleError
        ? (nearestObstacle?.center ?? center)
        : getRepulsionPointForError(srj, error, center)
      const nearestVia = getNearestVia(vias, center)
      if (
        nearestVia &&
        !sharesNet(
          nearestVia.rootConnectionName,
          nearestSegment.rootConnectionName,
        ) &&
        Math.hypot(nearestVia.x - center.x, nearestVia.y - center.y) < 0.45
      ) {
        changed =
          pushViaSegmentPair(
            routes,
            nearestVia,
            nearestSegment,
            srj.bounds,
            TRACE_PAD_REPAIR_MAX_MOVE * Math.abs(scale),
            1,
          ) || changed
      }

      const shouldUseObstacleMove =
        nearestObstacle !== undefined &&
        (isObstacleError ||
          (!obstacleSharesNet(
            nearestSegment.rootConnectionName,
            nearestObstacle,
          ) &&
            obstacleAppliesToSegment(nearestObstacle, nearestSegment)))
      const movedSegment = shouldUseObstacleMove
        ? moveSegmentAwayFromObstacle(
            routes,
            nearestSegment,
            nearestObstacle!,
            srj.bounds,
            scale,
          )
        : moveSegmentAwayFromPoint(
            routes,
            nearestSegment,
            repulsionPoint,
            srj.bounds,
            scale,
          )
      changed = movedSegment || changed
    }

    const nearestVia = getNearestVia(vias, center)
    if (
      nearestVia &&
      Math.hypot(nearestVia.x - center.x, nearestVia.y - center.y) < 0.35
    ) {
      changed =
        moveViaAwayFromPoint(routes, nearestVia, repulsionPoint, srj.bounds) ||
        changed
    }
  }

  return changed
}

export class GlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly inputHdRoutes: HighDensityRoute[]
  readonly effort: number
  readonly drcEvaluator?: DrcEvaluator
  readonly configuredMaxIterations?: number
  readonly enableLargeBoardBroadFallback: boolean
  outputHdRoutes: HighDensityRoute[]
  private initialDrcIssueCount: number | undefined
  private broadForceAccepted = false
  private targetedForceAccepted = false
  private candidateAttempts = 0
  private errorCursor = 0
  private stalledIterations = 0
  private bestDrcIssueCountSeen: number | undefined
  private lastDrcCountImprovementCheckIteration = 0
  private drcCountPlateauChecks = 0
  private largeBoardBroadFallbackMisses = 0
  private outputSnapshot: DrcSnapshot | undefined

  constructor(params: GlobalDrcForceImproveSolverParams) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.effort = params.effort ?? 1
    this.drcEvaluator = params.drcEvaluator
    this.configuredMaxIterations = params.maxIterations
    this.enableLargeBoardBroadFallback =
      params.enableLargeBoardBroadFallback ?? true
    this.outputHdRoutes = params.hdRoutes
    this.MAX_ITERATIONS =
      this.configuredMaxIterations ?? getBaseMaxIterations(this.effort)
  }

  override getConstructorParams() {
    return [
      {
        srj: this.srj,
        hdRoutes: this.inputHdRoutes,
        effort: this.effort,
        drcEvaluator: this.drcEvaluator,
        maxIterations: this.configuredMaxIterations,
        enableLargeBoardBroadFallback: this.enableLargeBoardBroadFallback,
      },
    ] as const
  }

  private updateStats(snapshot: DrcSnapshot) {
    this.stats = {
      initialDrcIssueCount: this.initialDrcIssueCount ?? snapshot.count,
      finalDrcIssueCount: snapshot.count,
      globalDrcForceImproveMaxIterations: this.MAX_ITERATIONS,
      globalDrcForceImproveBroadForceAccepted: this.broadForceAccepted,
      globalDrcForceImproveTargetedForceAccepted: this.targetedForceAccepted,
      globalDrcForceImproveCandidateAttempts: this.candidateAttempts,
      globalDrcForceImproveStalledIterations: this.stalledIterations,
      globalDrcForceImproveBestDrcIssueCountSeen:
        this.bestDrcIssueCountSeen ?? snapshot.count,
      globalDrcForceImproveDrcCountPlateauChecks: this.drcCountPlateauChecks,
      globalDrcForceImproveLargeBoardBroadFallbackMisses:
        this.largeBoardBroadFallbackMisses,
    }
  }

  private increaseMaxIterationsForDrcIssueCount(drcIssueCount: number) {
    if (this.configuredMaxIterations !== undefined) {
      this.MAX_ITERATIONS = this.configuredMaxIterations
      return
    }

    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      getDrcScaledMaxIterations(drcIssueCount, this.effort),
      getRouteComplexityMinIterations(this.inputHdRoutes.length, drcIssueCount),
    )
  }

  private acceptSolvedRoutes(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
  ) {
    this.outputHdRoutes = routes
    this.outputSnapshot = snapshot
    this.stalledIterations = 0
    this.updateStats(snapshot)
    this.solved = true
  }

  private updateDrcCountPlateauState(snapshot: DrcSnapshot) {
    this.bestDrcIssueCountSeen ??= snapshot.count
    const initialDrcIssueCount = this.initialDrcIssueCount ?? snapshot.count
    const isLargeRouteBoard =
      this.inputHdRoutes.length > BROAD_FALLBACK_SMALL_ROUTE_LIMIT &&
      initialDrcIssueCount > 0
    const needsLargeBoardBroadFallbackWindow = isLargeRouteBoard

    if (
      (initialDrcIssueCount >= LARGE_DRC_COUNT_THRESHOLD ||
        needsLargeBoardBroadFallbackWindow) &&
      this.iterations < MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK
    ) {
      if (snapshot.count < this.bestDrcIssueCountSeen) {
        this.bestDrcIssueCountSeen = snapshot.count
      }
      if (
        isLargeRouteBoard &&
        this.largeBoardBroadFallbackMisses >=
          MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES
      ) {
        this.solved = true
      }
      return
    }

    const improvementCheckInterval =
      getDrcCountImprovementCheckInterval(initialDrcIssueCount)

    if (
      this.iterations - this.lastDrcCountImprovementCheckIteration <
      improvementCheckInterval
    ) {
      return
    }

    this.lastDrcCountImprovementCheckIteration = this.iterations
    if (snapshot.count < this.bestDrcIssueCountSeen) {
      this.bestDrcIssueCountSeen = snapshot.count
      this.drcCountPlateauChecks = 0
      return
    }

    this.drcCountPlateauChecks += 1
    if (this.drcCountPlateauChecks >= MAX_DRC_COUNT_PLATEAU_CHECKS) {
      this.solved = true
    }
  }

  override _step() {
    let bestRoutes = this.outputHdRoutes
    let bestSnapshot =
      this.outputSnapshot ??
      getDrcSnapshot(this.srj, bestRoutes, this.drcEvaluator)
    if (this.initialDrcIssueCount === undefined) {
      this.initialDrcIssueCount = bestSnapshot.count
      this.bestDrcIssueCountSeen = bestSnapshot.count
      this.increaseMaxIterationsForDrcIssueCount(bestSnapshot.count)
    }

    if (bestSnapshot.count === 0) {
      this.updateStats(bestSnapshot)
      this.solved = true
      return
    }

    let bestIssueCount = bestSnapshot.count
    let bestIssueScore = bestSnapshot.issueScore
    let bestViaIssueCount = getViaDrcIssueCount(bestSnapshot)
    const centeredErrors = getCenteredErrors(bestSnapshot.errors)
    if (centeredErrors.length === 0) {
      this.updateStats(bestSnapshot)
      this.solved = true
      return
    }

    const maxCandidateAttemptsThisStep =
      getMaxTargetedCandidateAttemptsForEffort(this.effort)
    let candidateAttemptsThisStep = 0
    let acceptedCandidate = false
    let attemptedPeriodicLargeBoardBroadFallback = false
    const maxErrorsThisStep = Math.min(
      centeredErrors.length,
      Math.max(1, Math.ceil(this.effort)),
    )
    const startErrorIndex = this.errorCursor % centeredErrors.length

    for (
      let errorOffset = 0;
      errorOffset < maxErrorsThisStep &&
      candidateAttemptsThisStep < maxCandidateAttemptsThisStep;
      errorOffset += 1
    ) {
      const errorIndex = (startErrorIndex + errorOffset) % centeredErrors.length
      const error = centeredErrors[errorIndex]
      if (!error) continue

      this.errorCursor = (errorIndex + 1) % centeredErrors.length

      for (const scale of getForceScalesForEffort(this.effort)) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break

        const candidateRoutes = cloneRoutes(bestRoutes)
        const changed = applyDrcErrorForces(
          this.srj,
          candidateRoutes,
          [error],
          bestSnapshot.traceRouteIndexById,
          scale,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
        )
        const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
          )
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = candidateSnapshot.count
          bestIssueScore = candidateSnapshot.issueScore
          bestViaIssueCount = candidateViaIssueCount
          this.targetedForceAccepted = true
          acceptedCandidate = true
          if (candidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
          break
        }
      }

      if (acceptedCandidate) break
    }

    const canAffordBroadFallback =
      bestRoutes.length <= BROAD_FALLBACK_SMALL_ROUTE_LIMIT
    const largeBoardBroadFallbackCadence = getLargeBoardBroadFallbackCadence(
      centeredErrors.length,
    )
    const shouldTryPeriodicLargeBoardBroadFallback =
      this.enableLargeBoardBroadFallback &&
      this.MAX_ITERATIONS >= MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK &&
      !canAffordBroadFallback &&
      this.stalledIterations > 0 &&
      this.stalledIterations % largeBoardBroadFallbackCadence === 0
    if (
      !acceptedCandidate &&
      (canAffordBroadFallback ||
        (this.effort >= 2 && this.stalledIterations >= 2) ||
        shouldTryPeriodicLargeBoardBroadFallback)
    ) {
      attemptedPeriodicLargeBoardBroadFallback =
        shouldTryPeriodicLargeBoardBroadFallback
      const broadCandidateRoutes = applyBroadRepulsionForces(
        this.srj,
        bestRoutes,
        this.effort,
      )
      if (broadCandidateRoutes !== bestRoutes) {
        const broadCandidateSnapshot = getDrcSnapshot(
          this.srj,
          broadCandidateRoutes,
          this.drcEvaluator,
        )
        const broadCandidateViaIssueCount = getViaDrcIssueCount(
          broadCandidateSnapshot,
        )
        if (
          isBetterDrcSnapshot(
            broadCandidateSnapshot,
            broadCandidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
          )
        ) {
          bestRoutes = broadCandidateRoutes
          bestSnapshot = broadCandidateSnapshot
          bestIssueCount = broadCandidateSnapshot.count
          bestIssueScore = broadCandidateSnapshot.issueScore
          bestViaIssueCount = broadCandidateViaIssueCount
          this.broadForceAccepted = true
          acceptedCandidate = true
          if (broadCandidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
        }
      }
    }

    if (acceptedCandidate) {
      this.largeBoardBroadFallbackMisses = 0
    } else if (attemptedPeriodicLargeBoardBroadFallback) {
      this.largeBoardBroadFallbackMisses += 1
    }

    this.outputHdRoutes = bestRoutes
    this.outputSnapshot = bestSnapshot
    this.stalledIterations = acceptedCandidate ? 0 : this.stalledIterations + 1
    this.updateDrcCountPlateauState(bestSnapshot)
    this.updateStats(bestSnapshot)
    if (bestIssueCount === 0) {
      this.solved = true
    }
  }

  override tryFinalAcceptance() {
    this.solved = true
  }

  override getOutput() {
    return this.outputHdRoutes
  }
}
