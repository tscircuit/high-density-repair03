import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AutoroutingDrcEngine } from "../../drc"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import {
  cloneRoutesForIndexes,
  getDrcSnapshot,
  getTraceRoutePairForError,
  materializeRoutesForIndexes,
} from "./solverHelpers"
import type { DrcSnapshot } from "./types"

type Point = { x: number; y: number }
type RoutePoint = HighDensityRoute["route"][number]
type Bounds = SimpleRouteJson["bounds"]

type LocalObstacle =
  | {
      kind: "segment"
      start: Point
      end: Point
      z: number
      radius: number
    }
  | { kind: "circle"; center: Point; zLayers: number[]; radius: number }
  | {
      kind: "rect"
      bounds: Bounds
      zLayers: number[]
    }

type SearchNode = RoutePoint & {
  key: string
  viaCount: number
  distance: number
  estimate: number
  parentKey?: string
}

export type BoundedLocalRerouteBudgets = {
  maxWindowRadius: number
  maxGraphNodesPerSearch: number
  maxTotalGraphNodes: number
  maxGeneratedPaths: number
  maxCandidateEvaluations: number
  maxCanonicalEvaluations: number
  maxAddedVias: number
}

export const DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS: BoundedLocalRerouteBudgets =
  {
    maxWindowRadius: 2.4,
    maxGraphNodesPerSearch: 384,
    maxTotalGraphNodes: 8_192,
    maxGeneratedPaths: 12,
    maxCandidateEvaluations: 12,
    maxCanonicalEvaluations: 6,
    maxAddedVias: 2,
  }

export type BoundedLocalRerouteResult = {
  routes?: HighDensityRoute[]
  fastSnapshot?: DrcSnapshot
  canonicalSnapshot?: DrcSnapshot
  generatedPathCount: number
  graphNodeCount: number
  candidateEvaluationCount: number
  canonicalEvaluationCount: number
  attemptedRouteSides: Array<0 | 1>
}

const POSITION_EPSILON = 1e-6
const SEARCH_CLEARANCE_SLACK = 0.015

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const pointToSegmentDistance = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= POSITION_EPSILON) return distance(point, start)
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  )
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t })
}

const orientation = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  return (
    ((abC > POSITION_EPSILON && abD < -POSITION_EPSILON) ||
      (abC < -POSITION_EPSILON && abD > POSITION_EPSILON)) &&
    ((cdA > POSITION_EPSILON && cdB < -POSITION_EPSILON) ||
      (cdA < -POSITION_EPSILON && cdB > POSITION_EPSILON))
  )
}

const segmentToSegmentDistance = (a: Point, b: Point, c: Point, d: Point) => {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  )
}

const segmentIntersectsExpandedRect = (
  start: Point,
  end: Point,
  bounds: Bounds,
  expansion: number,
) => {
  const expanded = {
    minX: bounds.minX - expansion,
    minY: bounds.minY - expansion,
    maxX: bounds.maxX + expansion,
    maxY: bounds.maxY + expansion,
  }
  const inside = (point: Point) =>
    point.x >= expanded.minX &&
    point.x <= expanded.maxX &&
    point.y >= expanded.minY &&
    point.y <= expanded.maxY
  if (inside(start) || inside(end)) return true
  const corners = [
    { x: expanded.minX, y: expanded.minY },
    { x: expanded.maxX, y: expanded.minY },
    { x: expanded.maxX, y: expanded.maxY },
    { x: expanded.minX, y: expanded.maxY },
  ]
  return corners.some((corner, index) => {
    const nextCorner = corners[(index + 1) % 4]
    return nextCorner
      ? segmentsIntersect(start, end, corner, nextCorner)
      : false
  })
}

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const left = polygon[i]
    const right = polygon[j]
    if (!left || !right) continue
    if (
      left.y > point.y !== right.y > point.y &&
      point.x <
        ((right.x - left.x) * (point.y - left.y)) /
          (right.y - left.y || POSITION_EPSILON) +
          left.x
    ) {
      inside = !inside
    }
  }
  return inside
}

const getErrorCenter = (error: Record<string, unknown>): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const { x, y } = center as Record<string, unknown>
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}

const getNearestSegmentIndexes = (route: HighDensityRoute, center: Point) => {
  let best:
    | { startIndex: number; endIndex: number; distance: number }
    | undefined
  for (let index = 0; index < route.route.length - 1; index += 1) {
    const start = route.route[index]
    const end = route.route[index + 1]
    if (!start || !end || start.z !== end.z) continue
    const candidateDistance = pointToSegmentDistance(center, start, end)
    if (
      !best ||
      candidateDistance < best.distance - POSITION_EPSILON ||
      (Math.abs(candidateDistance - best.distance) <= POSITION_EPSILON &&
        index < best.startIndex)
    ) {
      best = {
        startIndex: index,
        endIndex: index + 1,
        distance: candidateDistance,
      }
    }
  }
  return best
}

const getViaLayersAt = (route: HighDensityRoute, index: number) => {
  const layers = new Set<number>()
  const point = route.route[index]
  if (!point) return []
  layers.add(point.z)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = route.route[cursor]
    if (!previous || distance(previous, point) > POSITION_EPSILON) break
    layers.add(previous.z)
  }
  for (let cursor = index + 1; cursor < route.route.length; cursor += 1) {
    const next = route.route[cursor]
    if (!next || distance(next, point) > POSITION_EPSILON) break
    layers.add(next.z)
  }
  return [...layers].sort((a, b) => a - b)
}

const buildLocalObstacleScene = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  changedRouteIndex: number,
  window: Bounds,
) => {
  const obstacles: LocalObstacle[] = []
  const overlapsWindow = (point: Point, radius: number) =>
    point.x + radius >= window.minX &&
    point.x - radius <= window.maxX &&
    point.y + radius >= window.minY &&
    point.y - radius <= window.maxY

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    if (routeIndex === changedRouteIndex) continue
    const route = routes[routeIndex]
    if (!route) continue
    const traceRadius = route.traceThickness / 2
    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end) continue
      if (start.z === end.z && distance(start, end) > POSITION_EPSILON) {
        if (
          Math.max(start.x, end.x) + traceRadius >= window.minX &&
          Math.min(start.x, end.x) - traceRadius <= window.maxX &&
          Math.max(start.y, end.y) + traceRadius >= window.minY &&
          Math.min(start.y, end.y) - traceRadius <= window.maxY
        ) {
          obstacles.push({
            kind: "segment",
            start,
            end,
            z: start.z,
            radius: traceRadius,
          })
        }
      } else if (
        start.z !== end.z &&
        distance(start, end) <= POSITION_EPSILON &&
        overlapsWindow(start, route.viaDiameter / 2)
      ) {
        obstacles.push({
          kind: "circle",
          center: start,
          zLayers: getViaLayersAt(route, index),
          radius: route.viaDiameter / 2,
        })
      }
    }
    for (const via of route.vias) {
      if (!overlapsWindow(via, route.viaDiameter / 2)) continue
      obstacles.push({
        kind: "circle",
        center: via,
        zLayers: Array.from({ length: srj.layerCount }, (_, z) => z),
        radius: route.viaDiameter / 2,
      })
    }
  }

  for (const obstacle of srj.obstacles) {
    const bounds = {
      minX: obstacle.center.x - obstacle.width / 2,
      minY: obstacle.center.y - obstacle.height / 2,
      maxX: obstacle.center.x + obstacle.width / 2,
      maxY: obstacle.center.y + obstacle.height / 2,
    }
    if (
      bounds.maxX < window.minX ||
      bounds.minX > window.maxX ||
      bounds.maxY < window.minY ||
      bounds.minY > window.maxY
    ) {
      continue
    }
    const zLayers =
      obstacle.zLayers ??
      Array.from({ length: srj.layerCount }, (_, z) => z).filter((z) =>
        obstacle.layers.includes(mapZToLayerName(z, srj.layerCount)),
      )
    obstacles.push({ kind: "rect", bounds, zLayers })
  }
  return obstacles
}

const isPointOnBoard = (srj: SimpleRouteJson, point: Point, margin: number) => {
  if (
    point.x < srj.bounds.minX + margin ||
    point.x > srj.bounds.maxX - margin ||
    point.y < srj.bounds.minY + margin ||
    point.y > srj.bounds.maxY - margin
  ) {
    return false
  }
  if (!srj.outline || srj.outline.length < 3) return true
  const outline = srj.outline
  if (!pointInPolygon(point, outline)) return false
  return outline.every((outlinePoint, index) => {
    const nextPoint = outline[(index + 1) % outline.length]
    return (
      nextPoint !== undefined &&
      pointToSegmentDistance(point, outlinePoint, nextPoint) >= margin
    )
  })
}

const isEdgeClear = (
  srj: SimpleRouteJson,
  obstacles: LocalObstacle[],
  start: RoutePoint,
  end: RoutePoint,
  traceRadius: number,
  traceClearance: number,
  allowedBoundaryAnchors: Point[],
) => {
  if (start.z !== end.z) return false
  const margin = traceRadius + SEARCH_CLEARANCE_SLACK
  const boardSamples = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }))
  if (
    boardSamples.some(
      (point) =>
        !allowedBoundaryAnchors.some(
          (anchor) => distance(point, anchor) <= POSITION_EPSILON,
        ) && !isPointOnBoard(srj, point, margin),
    )
  ) {
    return false
  }
  const required = traceRadius + traceClearance + SEARCH_CLEARANCE_SLACK
  return obstacles.every((obstacle) => {
    if (obstacle.kind === "segment") {
      return (
        obstacle.z !== start.z ||
        segmentToSegmentDistance(start, end, obstacle.start, obstacle.end) >=
          required + obstacle.radius
      )
    }
    if (!obstacle.zLayers.includes(start.z)) return true
    if (obstacle.kind === "circle") {
      return (
        pointToSegmentDistance(obstacle.center, start, end) >=
        required + obstacle.radius
      )
    }
    return !segmentIntersectsExpandedRect(start, end, obstacle.bounds, required)
  })
}

const isViaClear = (
  srj: SimpleRouteJson,
  obstacles: LocalObstacle[],
  point: RoutePoint,
  targetZ: number,
  viaRadius: number,
  clearance: number,
) => {
  if (!isPointOnBoard(srj, point, viaRadius + SEARCH_CLEARANCE_SLACK)) {
    return false
  }
  const minZ = Math.min(point.z, targetZ)
  const maxZ = Math.max(point.z, targetZ)
  const required = viaRadius + clearance + SEARCH_CLEARANCE_SLACK
  return obstacles.every((obstacle) => {
    const applies =
      obstacle.kind === "segment"
        ? obstacle.z >= minZ && obstacle.z <= maxZ
        : obstacle.zLayers.some((z) => z >= minZ && z <= maxZ)
    if (!applies) return true
    if (obstacle.kind === "segment") {
      return (
        pointToSegmentDistance(point, obstacle.start, obstacle.end) >=
        required + obstacle.radius
      )
    }
    if (obstacle.kind === "circle") {
      return distance(point, obstacle.center) >= required + obstacle.radius
    }
    return !segmentIntersectsExpandedRect(
      point,
      point,
      obstacle.bounds,
      required,
    )
  })
}

const simplifyPath = (path: RoutePoint[]) => {
  const simplified: RoutePoint[] = []
  for (const point of path) {
    const previous = simplified.at(-1)
    if (
      previous &&
      distance(previous, point) <= POSITION_EPSILON &&
      previous.z === point.z
    ) {
      continue
    }
    const beforePrevious = simplified.at(-2)
    if (
      beforePrevious &&
      previous &&
      beforePrevious.z === previous.z &&
      previous.z === point.z &&
      Math.abs(orientation(beforePrevious, previous, point)) <= POSITION_EPSILON
    ) {
      simplified[simplified.length - 1] = point
    } else {
      simplified.push(point)
    }
  }
  return simplified
}

const searchLocalPath = ({
  srj,
  start,
  end,
  window,
  obstacles,
  traceRadius,
  viaRadius,
  gridStep,
  directionBias,
  budgets,
}: {
  srj: SimpleRouteJson
  start: RoutePoint
  end: RoutePoint
  window: Bounds
  obstacles: LocalObstacle[]
  traceRadius: number
  viaRadius: number
  gridStep: number
  directionBias: -1 | 0 | 1
  budgets: BoundedLocalRerouteBudgets
}): { path?: RoutePoint[]; visitedNodeCount: number } => {
  const traceClearance = srj.minTraceToPadEdgeClearance ?? 0.1
  const viaClearance = srj.minViaEdgeToPadEdgeClearance ?? 0.1
  const keyFor = (point: RoutePoint) =>
    `${Math.round((point.x - window.minX) / gridStep)}:${Math.round(
      (point.y - window.minY) / gridStep,
    )}:${point.z}:${point.x === start.x && point.y === start.y ? "s" : ""}`
  const startNode: SearchNode = {
    ...start,
    key: "start",
    viaCount: 0,
    distance: 0,
    estimate: distance(start, end),
  }
  const open: SearchNode[] = [startNode]
  const bestDistance = new Map<string, number>([["start", 0]])
  const nodes = new Map<string, SearchNode>([["start", startNode]])
  let visitedNodeCount = 0
  const directX = end.x - start.x
  const directY = end.y - start.y
  const directLength = Math.max(POSITION_EPSILON, Math.hypot(directX, directY))
  const sideValue = (point: Point) =>
    ((point.x - start.x) * directY - (point.y - start.y) * directX) /
    directLength

  const reconstruct = (node: SearchNode) => {
    const reversed: RoutePoint[] = [{ ...end }]
    let cursor: SearchNode | undefined = node
    while (cursor) {
      reversed.push({ x: cursor.x, y: cursor.y, z: cursor.z })
      cursor = cursor.parentKey ? nodes.get(cursor.parentKey) : undefined
    }
    return simplifyPath(reversed.reverse())
  }

  while (open.length > 0 && visitedNodeCount < budgets.maxGraphNodesPerSearch) {
    open.sort(
      (left, right) =>
        left.estimate - right.estimate ||
        left.viaCount - right.viaCount ||
        left.z - right.z ||
        left.y - right.y ||
        left.x - right.x ||
        left.key.localeCompare(right.key),
    )
    const current = open.shift()
    if (!current) break
    if (current.distance !== bestDistance.get(current.key)) continue
    visitedNodeCount += 1

    if (
      current.z === end.z &&
      isEdgeClear(srj, obstacles, current, end, traceRadius, traceClearance, [
        start,
        end,
      ])
    ) {
      return { path: reconstruct(current), visitedNodeCount }
    }

    const neighbors: RoutePoint[] = []
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ] as const) {
      const x =
        window.minX +
        Math.round((current.x - window.minX) / gridStep + dx) * gridStep
      const y =
        window.minY +
        Math.round((current.y - window.minY) / gridStep + dy) * gridStep
      if (
        x < window.minX - POSITION_EPSILON ||
        x > window.maxX + POSITION_EPSILON ||
        y < window.minY - POSITION_EPSILON ||
        y > window.maxY + POSITION_EPSILON
      ) {
        continue
      }
      neighbors.push({ x, y, z: current.z })
    }
    if (current.viaCount < budgets.maxAddedVias) {
      for (let z = 0; z < srj.layerCount; z += 1) {
        if (z !== current.z) neighbors.push({ x: current.x, y: current.y, z })
      }
    }

    for (const neighbor of neighbors) {
      const isVia = neighbor.z !== current.z
      if (
        isVia
          ? !isViaClear(
              srj,
              obstacles,
              current,
              neighbor.z,
              viaRadius,
              viaClearance,
            )
          : !isEdgeClear(
              srj,
              obstacles,
              current,
              neighbor,
              traceRadius,
              traceClearance,
              [start, end],
            )
      ) {
        continue
      }
      const viaCount = current.viaCount + (isVia ? 1 : 0)
      if (viaCount > budgets.maxAddedVias) continue
      const side = sideValue(neighbor)
      const biasPenalty =
        directionBias === 0
          ? 0
          : Math.max(0, directionBias * side) * gridStep * 0.35
      const stepCost = isVia
        ? Math.max(0.8, viaRadius * 4)
        : distance(current, neighbor)
      const nextDistance = current.distance + stepCost + biasPenalty
      const key = keyFor(neighbor)
      if (nextDistance >= (bestDistance.get(key) ?? Number.POSITIVE_INFINITY)) {
        continue
      }
      const nextNode: SearchNode = {
        ...neighbor,
        key,
        viaCount,
        distance: nextDistance,
        estimate:
          nextDistance +
          distance(neighbor, end) +
          (neighbor.z === end.z ? 0 : 0.8),
        parentKey: current.key,
      }
      bestDistance.set(key, nextDistance)
      nodes.set(key, nextNode)
      open.push(nextNode)
    }
  }
  return { visitedNodeCount }
}

const isCanonicalImprovement = (
  candidate: DrcSnapshot,
  baseline: DrcSnapshot,
) =>
  candidate.count < baseline.count ||
  (candidate.count === baseline.count &&
    candidate.issueScore < baseline.issueScore - POSITION_EPSILON)

export const attemptBoundedLocalReroute = ({
  srj,
  routes,
  error,
  traceRouteIndexById,
  autoroutingDrcEngine,
  connMap,
  budgets = DEFAULT_BOUNDED_LOCAL_REROUTE_BUDGETS,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  error: Record<string, unknown>
  traceRouteIndexById: Map<string, number>
  autoroutingDrcEngine: AutoroutingDrcEngine
  connMap?: ConnectivityMap
  budgets?: BoundedLocalRerouteBudgets
}): BoundedLocalRerouteResult => {
  const result: BoundedLocalRerouteResult = {
    generatedPathCount: 0,
    graphNodeCount: 0,
    candidateEvaluationCount: 0,
    canonicalEvaluationCount: 0,
    attemptedRouteSides: [],
  }
  if (error.type !== "pcb_trace_error") return result
  const center = getErrorCenter(error)
  const routePair = getTraceRoutePairForError(error, traceRouteIndexById)
  if (!center || !routePair) return result

  const generated: Array<{
    routes: HighDensityRoute[]
    routeSide: 0 | 1
    pathLength: number
    viaCount: number
    fastSnapshot?: DrcSnapshot
  }> = []
  const pathKeys = new Set<string>()

  for (const routeSide of [0, 1] as const) {
    const routeSideGraphLimit =
      ((routeSide + 1) * budgets.maxTotalGraphNodes) / 2
    const routeSidePathLimit = Math.floor(
      ((routeSide + 1) * budgets.maxGeneratedPaths) / 2,
    )
    const changedRouteIndex = routePair[routeSide]
    const route = routes[changedRouteIndex]
    if (!route) continue
    const segment = getNearestSegmentIndexes(route, center)
    if (!segment) continue
    result.attemptedRouteSides.push(routeSide)

    // Prefer anchors outside the immediately conflicting point cluster. The
    // exact segment remains the center of the replaced span, but one or two
    // adjacent same-layer points often provide the first legal place for a via.
    for (const spanExpansion of [1, 2, 0]) {
      if (
        generated.length >= routeSidePathLimit ||
        result.graphNodeCount >= routeSideGraphLimit
      ) {
        break
      }
      const startIndex = Math.max(0, segment.startIndex - spanExpansion)
      const endIndex = Math.min(
        route.route.length - 1,
        segment.endIndex + spanExpansion,
      )
      const start = route.route[startIndex]
      const end = route.route[endIndex]
      if (!start || !end || start.z !== end.z) continue
      const neededRadius =
        Math.max(distance(center, start), distance(center, end)) + 0.35
      for (const requestedRadius of [0.8, 1.2, 1.8, 2.4]) {
        if (
          requestedRadius + POSITION_EPSILON < neededRadius ||
          requestedRadius > budgets.maxWindowRadius ||
          generated.length >= routeSidePathLimit ||
          result.graphNodeCount >= routeSideGraphLimit
        ) {
          continue
        }
        const window = {
          minX: Math.max(srj.bounds.minX, center.x - requestedRadius),
          minY: Math.max(srj.bounds.minY, center.y - requestedRadius),
          maxX: Math.min(srj.bounds.maxX, center.x + requestedRadius),
          maxY: Math.min(srj.bounds.maxY, center.y + requestedRadius),
        }
        const obstacles = buildLocalObstacleScene(
          srj,
          routes,
          changedRouteIndex,
          window,
        )
        for (const directionBias of [-1, 1, 0] as const) {
          if (
            generated.length >= routeSidePathLimit ||
            result.graphNodeCount >= routeSideGraphLimit
          ) {
            break
          }
          const remainingNodeBudget =
            routeSideGraphLimit - result.graphNodeCount
          const searchBudgets = {
            ...budgets,
            maxGraphNodesPerSearch: Math.min(
              budgets.maxGraphNodesPerSearch,
              remainingNodeBudget,
            ),
          }
          const search = searchLocalPath({
            srj,
            start,
            end,
            window,
            obstacles,
            traceRadius: route.traceThickness / 2,
            viaRadius: route.viaDiameter / 2,
            gridStep: requestedRadius <= 1.2 ? 0.12 : 0.18,
            directionBias,
            budgets: searchBudgets,
          })
          result.graphNodeCount += search.visitedNodeCount
          if (!search.path || search.path.length < 2) continue
          const pathKey = search.path
            .map(
              (point) =>
                `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z}`,
            )
            .join(";")
          if (pathKeys.has(pathKey)) continue
          pathKeys.add(pathKey)

          const candidateRoutes = cloneRoutesForIndexes(routes, [
            changedRouteIndex,
          ])
          const candidateRoute = candidateRoutes[changedRouteIndex]
          if (!candidateRoute) continue
          candidateRoute.route.splice(
            startIndex,
            endIndex - startIndex + 1,
            { ...start },
            ...search.path.slice(1, -1).map((point) => ({ ...point })),
            { ...end },
          )
          const materialized = materializeRoutesForIndexes(candidateRoutes, [
            changedRouteIndex,
          ])
          const path = search.path
          generated.push({
            routes: materialized,
            routeSide,
            pathLength: path.slice(1).reduce((sum, point, index) => {
              const previous = path[index]
              return previous ? sum + distance(previous, point) : sum
            }, 0),
            viaCount: path.filter(
              (point, index) => index > 0 && point.z !== path[index - 1]?.z,
            ).length,
          })
          result.generatedPathCount = generated.length
        }
      }
    }
  }

  for (const candidate of generated.slice(0, budgets.maxCandidateEvaluations)) {
    candidate.fastSnapshot = getDrcSnapshot(
      srj,
      candidate.routes,
      undefined,
      connMap,
      autoroutingDrcEngine,
    )
    result.candidateEvaluationCount += 1
  }
  const fastBaseline = getDrcSnapshot(
    srj,
    routes,
    undefined,
    connMap,
    autoroutingDrcEngine,
  )
  const ranked = generated
    .filter(
      (
        candidate,
      ): candidate is typeof candidate & { fastSnapshot: DrcSnapshot } =>
        candidate.fastSnapshot !== undefined,
    )
    .filter(
      (candidate) =>
        candidate.fastSnapshot.count < fastBaseline.count ||
        (candidate.fastSnapshot.count === fastBaseline.count &&
          candidate.fastSnapshot.issueScore <=
            fastBaseline.issueScore + POSITION_EPSILON),
    )
    .sort(
      (left, right) =>
        left.fastSnapshot.count - right.fastSnapshot.count ||
        left.fastSnapshot.issueScore - right.fastSnapshot.issueScore ||
        left.viaCount - right.viaCount ||
        left.pathLength - right.pathLength ||
        left.routeSide - right.routeSide,
    )
  const canonicalBaseline = getDrcSnapshot(srj, routes, undefined, connMap)
  for (const candidate of ranked.slice(0, budgets.maxCanonicalEvaluations)) {
    const canonicalSnapshot = getDrcSnapshot(
      srj,
      candidate.routes,
      undefined,
      connMap,
    )
    result.canonicalEvaluationCount += 1
    if (!isCanonicalImprovement(canonicalSnapshot, canonicalBaseline)) continue
    result.routes = candidate.routes
    result.fastSnapshot = candidate.fastSnapshot
    result.canonicalSnapshot = canonicalSnapshot
    return result
  }
  return result
}
