import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "../../types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import type { Bounds2D, MutableRoute, Point } from "./internalTypes"
import { COORDINATE_EPSILON, POSITION_EPSILON } from "./solverConfig"
import { clampValue } from "./spatialIndex"

export const PAD_TRACE_CLEARANCE_DETOUR_VARIANT_COUNT = 8

type RoutePoint = MutableRoute["route"][number]
type Obstacle = SimpleRouteJson["obstacles"][number]

const getErrorCenter = (error: Record<string, unknown>): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined

  const candidate = center as Record<string, unknown>
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return undefined
  }
  return { x: candidate.x, y: candidate.y }
}

const getObstacleBounds = (obstacle: Obstacle): Bounds2D => ({
  minX: obstacle.center.x - obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const getObstacleLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  if (obstacle.zLayers && obstacle.zLayers.length > 0) {
    return obstacle.zLayers
  }

  const layers = Array.from({ length: layerCount }, (_, z) => z).filter((z) =>
    obstacle.layers.includes(mapZToLayerName(z, layerCount)),
  )
  return layers.length > 0
    ? layers
    : Array.from({ length: layerCount }, (_, z) => z)
}

const getPointToBoundsDistance = (point: Point, bounds: Bounds2D): number => {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX)
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY)
  return Math.hypot(dx, dy)
}

const pointsSharePosition = (left: Point, right: Point): boolean =>
  Math.abs(left.x - right.x) <= COORDINATE_EPSILON &&
  Math.abs(left.y - right.y) <= COORDINATE_EPSILON

const pointIsInsideBounds = (point: Point, bounds: Bounds2D): boolean =>
  point.x > bounds.minX + POSITION_EPSILON &&
  point.x < bounds.maxX - POSITION_EPSILON &&
  point.y > bounds.minY + POSITION_EPSILON &&
  point.y < bounds.maxY - POSITION_EPSILON

type TransitionRelocation = {
  pointIndexes: number[]
  target: RoutePoint
}

const selectExactObstacle = ({
  srj,
  padId,
  errorCenter,
}: {
  srj: SimpleRouteJson
  padId: string
  errorCenter: Point
}): Obstacle | undefined => {
  const candidates = srj.obstacles.filter(
    (obstacle) =>
      obstacle.obstacleId === padId || obstacle.connectedTo.includes(padId),
  )
  return candidates.sort((left, right) => {
    const leftDistance = getPointToBoundsDistance(
      errorCenter,
      getObstacleBounds(left),
    )
    const rightDistance = getPointToBoundsDistance(
      errorCenter,
      getObstacleBounds(right),
    )
    return leftDistance - rightDistance
  })[0]
}

const projectPointOntoSegment = ({
  point,
  start,
  end,
}: {
  point: Point
  start: Point
  end: Point
}): Point => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= POSITION_EPSILON) return start

  const t = clampValue(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  )
  return { x: start.x + dx * t, y: start.y + dy * t }
}

const getAffectedRun = ({
  route,
  obstacle,
  srj,
  errorCenter,
  clearance,
}: {
  route: MutableRoute
  obstacle: Obstacle
  srj: SimpleRouteJson
  errorCenter: Point
  clearance: number
}): number[] | undefined => {
  const obstacleBounds = getObstacleBounds(obstacle)
  const obstacleLayers = new Set(getObstacleLayers(obstacle, srj.layerCount))
  const affectedSegmentIndexes: number[] = []

  for (let index = 0; index < route.route.length - 1; index += 1) {
    const start = route.route[index]
    const end = route.route[index + 1]
    if (!start || !end || start.z !== end.z || !obstacleLayers.has(start.z)) {
      continue
    }
    if (
      segmentToBoundsMinDistance(start, end, obstacleBounds) <
      clearance - POSITION_EPSILON
    ) {
      affectedSegmentIndexes.push(index)
    }
  }

  const runs: number[][] = []
  for (const segmentIndex of affectedSegmentIndexes) {
    const currentRun = runs.at(-1)
    if (currentRun?.at(-1) === segmentIndex - 1) {
      currentRun.push(segmentIndex)
    } else {
      runs.push([segmentIndex])
    }
  }
  return runs.sort((left, right) => {
    const getRunDistance = (run: number[]): number =>
      Math.min(
        ...run.map((segmentIndex) => {
          const start = route.route[segmentIndex]!
          const end = route.route[segmentIndex + 1]!
          const projection = projectPointOntoSegment({
            point: errorCenter,
            start,
            end,
          })
          return Math.hypot(
            errorCenter.x - projection.x,
            errorCenter.y - projection.y,
          )
        }),
      )
    return getRunDistance(left) - getRunDistance(right)
  })[0]
}

const segmentCrossesBoundsInterior = ({
  start,
  end,
  bounds,
}: {
  start: Point
  end: Point
  bounds: Bounds2D
}): boolean => {
  const interior = {
    minX: bounds.minX + POSITION_EPSILON,
    minY: bounds.minY + POSITION_EPSILON,
    maxX: bounds.maxX - POSITION_EPSILON,
    maxY: bounds.maxY - POSITION_EPSILON,
  }
  let minimumT = 0
  let maximumT = 1

  for (const [startValue, delta, minimum, maximum] of [
    [start.x, end.x - start.x, interior.minX, interior.maxX],
    [start.y, end.y - start.y, interior.minY, interior.maxY],
  ] as const) {
    if (Math.abs(delta) <= POSITION_EPSILON) {
      if (startValue <= minimum || startValue >= maximum) return false
      continue
    }
    const firstT = (minimum - startValue) / delta
    const secondT = (maximum - startValue) / delta
    minimumT = Math.max(minimumT, Math.min(firstT, secondT))
    maximumT = Math.min(maximumT, Math.max(firstT, secondT))
    if (minimumT > maximumT) return false
  }
  return minimumT <= maximumT
}

const isPointOnBoard = (point: Point, srj: SimpleRouteJson): boolean => {
  if (
    point.x < srj.bounds.minX - COORDINATE_EPSILON ||
    point.x > srj.bounds.maxX + COORDINATE_EPSILON ||
    point.y < srj.bounds.minY - COORDINATE_EPSILON ||
    point.y > srj.bounds.maxY + COORDINATE_EPSILON
  ) {
    return false
  }
  if (!srj.outline || srj.outline.length < 3) return true

  let inside = false
  for (
    let index = 0, previousIndex = srj.outline.length - 1;
    index < srj.outline.length;
    previousIndex = index, index += 1
  ) {
    const current = srj.outline[index]!
    const previous = srj.outline[previousIndex]!
    if (
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x
    ) {
      inside = !inside
    }
  }
  return inside
}

const getTransitionRelocation = ({
  route,
  anchorIndex,
  bounds,
  srj,
}: {
  route: MutableRoute
  anchorIndex: number
  bounds: Bounds2D
  srj: SimpleRouteJson
}): TransitionRelocation | undefined => {
  const anchor = route.route[anchorIndex]
  if (!anchor) return undefined

  let transitionStartIndex = anchorIndex
  while (
    transitionStartIndex > 0 &&
    pointsSharePosition(route.route[transitionStartIndex - 1]!, anchor)
  ) {
    transitionStartIndex -= 1
  }
  let transitionEndIndex = anchorIndex
  while (
    transitionEndIndex + 1 < route.route.length &&
    pointsSharePosition(route.route[transitionEndIndex + 1]!, anchor)
  ) {
    transitionEndIndex += 1
  }

  const pointIndexes = Array.from(
    { length: transitionEndIndex - transitionStartIndex + 1 },
    (_, offset) => transitionStartIndex + offset,
  )
  if (
    transitionStartIndex === 0 ||
    transitionEndIndex === route.route.length - 1 ||
    new Set(pointIndexes.map((index) => route.route[index]!.z)).size < 2
  ) {
    return undefined
  }

  const target = [
    { ...anchor, x: bounds.minX },
    { ...anchor, x: bounds.maxX },
    { ...anchor, y: bounds.minY },
    { ...anchor, y: bounds.maxY },
  ]
    .filter((candidate) => isPointOnBoard(candidate, srj))
    .sort(
      (left, right) =>
        Math.hypot(left.x - anchor.x, left.y - anchor.y) -
        Math.hypot(right.x - anchor.x, right.y - anchor.y),
    )[0]
  if (!target) return undefined

  return { pointIndexes, target }
}

const getPathLength = ({
  start,
  path,
  end,
}: {
  start: Point
  path: Point[]
  end: Point
}): number => {
  const points = [start, ...path, end]
  return points.slice(0, -1).reduce((total, point, index) => {
    const next = points[index + 1]!
    return total + Math.hypot(next.x - point.x, next.y - point.y)
  }, 0)
}

const getValidDetourPaths = ({
  start,
  end,
  bounds,
  srj,
}: {
  start: Point
  end: Point
  bounds: Bounds2D
  srj: SimpleRouteJson
}): Point[][] => {
  const topLeft = { x: bounds.minX, y: bounds.maxY }
  const topRight = { x: bounds.maxX, y: bounds.maxY }
  const bottomRight = { x: bounds.maxX, y: bounds.minY }
  const bottomLeft = { x: bounds.minX, y: bounds.minY }
  const sidePaths = [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ]

  return sidePaths
    .flatMap((path) => [path, [...path].reverse()])
    .filter((path) => path.every((point) => isPointOnBoard(point, srj)))
    .filter((path) => {
      const points = [start, ...path, end]
      return points
        .slice(0, -1)
        .every(
          (point, index) =>
            !segmentCrossesBoundsInterior({
              start: point,
              end: points[index + 1]!,
              bounds,
            }),
        )
    })
    .sort(
      (left, right) =>
        getPathLength({ start, path: left, end }) -
        getPathLength({ start, path: right, end }),
    )
}

export const applyPadTraceClearanceDetour = ({
  srj,
  routes,
  routeIndex,
  error,
  variantIndex,
}: {
  srj: SimpleRouteJson
  routes: MutableRoute[]
  routeIndex: number
  error: Record<string, unknown>
  variantIndex: number
}): boolean => {
  const padId = error.pcb_pad_id
  const errorCenter = getErrorCenter(error)
  if (
    typeof padId !== "string" ||
    !errorCenter ||
    !Number.isInteger(variantIndex) ||
    variantIndex < 0
  ) {
    return false
  }

  const route = routes[routeIndex]
  const obstacle = selectExactObstacle({ srj, padId, errorCenter })
  if (!route || !obstacle) return false

  const minimumClearance =
    typeof error.minimum_clearance === "number"
      ? error.minimum_clearance
      : (srj.minTraceToPadEdgeClearance ?? 0.1)
  const clearance =
    (route.traceThickness ?? srj.minTraceWidth) / 2 +
    minimumClearance +
    POSITION_EPSILON
  const affectedRun = getAffectedRun({
    route,
    obstacle,
    srj,
    errorCenter,
    clearance,
  })
  const firstSegmentIndex = affectedRun?.[0]
  const lastSegmentIndex = affectedRun?.at(-1)
  if (firstSegmentIndex === undefined || lastSegmentIndex === undefined) {
    return false
  }

  const startAnchor = route.route[firstSegmentIndex]
  const endAnchor = route.route[lastSegmentIndex + 1]
  if (!startAnchor || !endAnchor || startAnchor.z !== endAnchor.z) return false

  const obstacleBounds = getObstacleBounds(obstacle)
  const clearanceBounds = {
    minX: obstacleBounds.minX - clearance,
    minY: obstacleBounds.minY - clearance,
    maxX: obstacleBounds.maxX + clearance,
    maxY: obstacleBounds.maxY + clearance,
  }
  const startRelocation = pointIsInsideBounds(startAnchor, clearanceBounds)
    ? getTransitionRelocation({
        route,
        anchorIndex: firstSegmentIndex,
        bounds: clearanceBounds,
        srj,
      })
    : undefined
  const endRelocation = pointIsInsideBounds(endAnchor, clearanceBounds)
    ? getTransitionRelocation({
        route,
        anchorIndex: lastSegmentIndex + 1,
        bounds: clearanceBounds,
        srj,
      })
    : undefined
  if (
    (pointIsInsideBounds(startAnchor, clearanceBounds) && !startRelocation) ||
    (pointIsInsideBounds(endAnchor, clearanceBounds) && !endRelocation) ||
    (startRelocation &&
      endRelocation &&
      startRelocation.pointIndexes.some((index) =>
        endRelocation.pointIndexes.includes(index),
      ))
  ) {
    return false
  }

  const detourPath = getValidDetourPaths({
    start: startRelocation?.target ?? startAnchor,
    end: endRelocation?.target ?? endAnchor,
    bounds: clearanceBounds,
    srj,
  })[variantIndex]
  if (!detourPath) return false

  for (const relocation of [startRelocation, endRelocation]) {
    if (!relocation) continue
    for (const pointIndex of relocation.pointIndexes) {
      const point = route.route[pointIndex]!
      point.x = relocation.target.x
      point.y = relocation.target.y
    }
  }

  const detourPoints: RoutePoint[] = detourPath.map((point) => ({
    ...startAnchor,
    ...point,
    z: startAnchor.z,
    pcb_port_id: undefined,
  }))
  route.route.splice(
    firstSegmentIndex + 1,
    lastSegmentIndex - firstSegmentIndex,
    ...detourPoints,
  )
  return true
}
