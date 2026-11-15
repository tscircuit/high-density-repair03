// Frozen board-translation helpers from high-density-repair03 5ec4410.
import {
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "../../lib/types"
import type {
  MutableRoute,
  Point,
} from "../../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import { RELAXED_DRC_OPTIONS } from "../../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import {
  COORDINATE_EPSILON,
  POSITION_EPSILON,
  PREFERRED_TRACE_TO_PAD_CLEARANCE,
} from "../../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { clampValue } from "../../lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"

const projectPointOntoLineSegment = (
  point: Point,
  start: Point,
  end: Point,
) => {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared <= POSITION_EPSILON) {
    return { x: start.x, y: start.y, t: 0 }
  }

  const t = clampValue(
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
      lengthSquared,
    0,
    1,
  )

  return {
    x: start.x + segmentX * t,
    y: start.y + segmentY * t,
    t,
  }
}

const pointIsInsideBounds = (point: Point, bounds: SimpleRouteJson["bounds"]) =>
  point.x >= bounds.minX - COORDINATE_EPSILON &&
  point.x <= bounds.maxX + COORDINATE_EPSILON &&
  point.y >= bounds.minY - COORDINATE_EPSILON &&
  point.y <= bounds.maxY + COORDINATE_EPSILON

const getPointBoundsClearance = (
  point: Point,
  bounds: SimpleRouteJson["bounds"],
) =>
  Math.min(
    point.x - bounds.minX,
    bounds.maxX - point.x,
    point.y - bounds.minY,
    bounds.maxY - point.y,
  )

const pointIsOnSegment = (point: Point, start: Point, end: Point) => {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const pointX = point.x - start.x
  const pointY = point.y - start.y
  const cross = segmentX * pointY - segmentY * pointX
  if (Math.abs(cross) > COORDINATE_EPSILON) return false

  const minX = Math.min(start.x, end.x) - COORDINATE_EPSILON
  const maxX = Math.max(start.x, end.x) + COORDINATE_EPSILON
  const minY = Math.min(start.y, end.y) - COORDINATE_EPSILON
  const maxY = Math.max(start.y, end.y) + COORDINATE_EPSILON

  return (
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  )
}

const pointIsInsideOutline = (
  point: Point,
  outline: NonNullable<SimpleRouteJson["outline"]>,
) => {
  if (outline.length < 3) return true

  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index]
    const end = outline[(index + 1) % outline.length]
    if (!start || !end) continue
    if (pointIsOnSegment(point, start, end)) return true
  }

  let inside = false
  for (
    let index = 0, previousIndex = outline.length - 1;
    index < outline.length;
    previousIndex = index, index += 1
  ) {
    const current = outline[index]
    const previous = outline[previousIndex]
    if (!current || !previous) continue

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (intersects) inside = !inside
  }

  return inside
}

const getPointOutlineClearance = (
  point: Point,
  outline: NonNullable<SimpleRouteJson["outline"]>,
) => {
  let minDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index]
    const end = outline[(index + 1) % outline.length]
    if (!start || !end) continue
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistance(point, start, end),
    )
  }

  return minDistance
}

const normalizeVector = (x: number, y: number) => {
  const length = Math.hypot(x, y)
  if (length <= POSITION_EPSILON) return undefined
  return { x: x / length, y: y / length }
}

const getOutlineSignedArea = (
  outline: NonNullable<SimpleRouteJson["outline"]>,
) => {
  let signedArea = 0

  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index]
    const next = outline[(index + 1) % outline.length]
    if (!current || !next) continue
    signedArea += current.x * next.y - next.x * current.y
  }

  return signedArea / 2
}

const getBoundsInwardNormal = (
  point: Point,
  bounds: SimpleRouteJson["bounds"],
) => {
  const leftClearance = point.x - bounds.minX
  const rightClearance = bounds.maxX - point.x
  const bottomClearance = point.y - bounds.minY
  const topClearance = bounds.maxY - point.y
  const minClearance = Math.min(
    leftClearance,
    rightClearance,
    bottomClearance,
    topClearance,
  )

  let inwardX = 0
  let inwardY = 0

  if (leftClearance <= minClearance + COORDINATE_EPSILON) inwardX += 1
  if (rightClearance <= minClearance + COORDINATE_EPSILON) inwardX -= 1
  if (bottomClearance <= minClearance + COORDINATE_EPSILON) inwardY += 1
  if (topClearance <= minClearance + COORDINATE_EPSILON) inwardY -= 1

  return normalizeVector(inwardX, inwardY)
}

const getOutlineInwardNormal = (
  point: Point,
  outline: NonNullable<SimpleRouteJson["outline"]>,
) => {
  const isInside = pointIsInsideOutline(point, outline)
  let nearestEdge:
    | {
        projection: Point
        start: Point
        end: Point
        distance: number
      }
    | undefined

  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index]
    const end = outline[(index + 1) % outline.length]
    if (!start || !end) continue

    const projection = projectPointOntoLineSegment(point, start, end)
    const distance = Math.hypot(point.x - projection.x, point.y - projection.y)
    if (!nearestEdge || distance < nearestEdge.distance) {
      nearestEdge = { projection, start, end, distance }
    }
  }

  if (!nearestEdge) return undefined

  const normalFromClosestPoint = normalizeVector(
    isInside
      ? point.x - nearestEdge.projection.x
      : nearestEdge.projection.x - point.x,
    isInside
      ? point.y - nearestEdge.projection.y
      : nearestEdge.projection.y - point.y,
  )
  if (normalFromClosestPoint) return normalFromClosestPoint

  const edgeX = nearestEdge.end.x - nearestEdge.start.x
  const edgeY = nearestEdge.end.y - nearestEdge.start.y
  const edgeLength = Math.hypot(edgeX, edgeY)
  if (edgeLength <= POSITION_EPSILON) return undefined

  const isCounterClockwise = getOutlineSignedArea(outline) >= 0
  return {
    x: isCounterClockwise ? -edgeY / edgeLength : edgeY / edgeLength,
    y: isCounterClockwise ? edgeX / edgeLength : -edgeX / edgeLength,
  }
}

const getPointBoardInwardNormal = (srj: SimpleRouteJson, point: Point) =>
  srj.outline && srj.outline.length >= 3
    ? getOutlineInwardNormal(point, srj.outline)
    : getBoundsInwardNormal(point, srj.bounds)

const pointIsInsideBoard = (srj: SimpleRouteJson, point: Point) =>
  srj.outline && srj.outline.length >= 3
    ? pointIsInsideOutline(point, srj.outline)
    : pointIsInsideBounds(point, srj.bounds)

const getPointBoardClearance = (srj: SimpleRouteJson, point: Point) => {
  if (srj.outline && srj.outline.length >= 3) {
    const clearance = getPointOutlineClearance(point, srj.outline)
    return pointIsInsideOutline(point, srj.outline) ? clearance : -clearance
  }

  return getPointBoundsClearance(point, srj.bounds)
}

const getSegmentBoardClearance = (
  srj: SimpleRouteJson,
  start: Point,
  end: Point,
) => {
  if (
    Math.abs(start.x - end.x) <= COORDINATE_EPSILON &&
    Math.abs(start.y - end.y) <= COORDINATE_EPSILON
  ) {
    return Math.min(
      getPointBoardClearance(srj, start),
      getPointBoardClearance(srj, end),
    )
  }

  if (srj.outline && srj.outline.length >= 3) {
    if (
      !pointIsInsideOutline(start, srj.outline) ||
      !pointIsInsideOutline(end, srj.outline)
    ) {
      return Math.min(
        getPointBoardClearance(srj, start),
        getPointBoardClearance(srj, end),
      )
    }

    let minDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < srj.outline.length; index += 1) {
      const edgeStart = srj.outline[index]
      const edgeEnd = srj.outline[(index + 1) % srj.outline.length]
      if (!edgeStart || !edgeEnd) continue
      minDistance = Math.min(
        minDistance,
        segmentToSegmentMinDistance(start, end, edgeStart, edgeEnd),
      )
    }
    return minDistance
  }

  if (
    !pointIsInsideBounds(start, srj.bounds) ||
    !pointIsInsideBounds(end, srj.bounds)
  ) {
    return Math.min(
      getPointBoardClearance(srj, start),
      getPointBoardClearance(srj, end),
    )
  }

  return Math.min(
    getPointBoundsClearance(start, srj.bounds),
    getPointBoundsClearance(end, srj.bounds),
  )
}

const getBoardEdgeProximityThreshold = (
  srj: SimpleRouteJson,
  featureRadius: number,
) =>
  featureRadius +
  Math.max(
    PREFERRED_TRACE_TO_PAD_CLEARANCE,
    srj.defaultObstacleMargin ?? 0,
    RELAXED_DRC_OPTIONS.traceClearance ?? 0.1,
  )

const moveReducesClearanceIntoBoardEdgeZone = (
  currentClearance: number,
  nextClearance: number,
  edgeProximityThreshold: number,
) =>
  nextClearance < currentClearance - COORDINATE_EPSILON &&
  Math.min(currentClearance, nextClearance) <=
    edgeProximityThreshold + COORDINATE_EPSILON

const clipTranslationAgainstBoardEdge = (
  dx: number,
  dy: number,
  inwardNormal: Point,
  currentClearance: number,
  edgeProximityThreshold: number,
) => {
  const dot = dx * inwardNormal.x + dy * inwardNormal.y
  const maxOutwardMotion = Math.max(
    0,
    currentClearance - edgeProximityThreshold,
  )
  const minAllowedDot = -maxOutwardMotion

  if (dot >= minAllowedDot - COORDINATE_EPSILON) {
    return { x: dx, y: dy }
  }

  const adjustment = minAllowedDot - dot
  return {
    x: dx + inwardNormal.x * adjustment,
    y: dy + inwardNormal.y * adjustment,
  }
}

const clipPointTranslationAwayFromBoardEdge = (
  srj: SimpleRouteJson,
  point: Point,
  dx: number,
  dy: number,
  featureRadius: number,
) => {
  const inwardNormal = getPointBoardInwardNormal(srj, point)
  if (!inwardNormal) return { x: dx, y: dy }

  return clipTranslationAgainstBoardEdge(
    dx,
    dy,
    inwardNormal,
    getPointBoardClearance(srj, point),
    getBoardEdgeProximityThreshold(srj, featureRadius),
  )
}

const clipPointIndexesTranslationAwayFromBoardEdge = (
  srj: SimpleRouteJson,
  route: MutableRoute,
  pointIndexes: number[],
  dx: number,
  dy: number,
  featureRadius: number,
) => {
  const uniquePointIndexes = [...new Set(pointIndexes)].sort(
    (left, right) => left - right,
  )
  let translation = { x: dx, y: dy }
  const edgeProximityThreshold = getBoardEdgeProximityThreshold(
    srj,
    featureRadius,
  )

  for (let pass = 0; pass < Math.max(1, uniquePointIndexes.length); pass += 1) {
    let changed = false

    for (const pointIndex of uniquePointIndexes) {
      const point = route.route[pointIndex]
      if (!point) continue

      const inwardNormal = getPointBoardInwardNormal(srj, point)
      if (!inwardNormal) continue

      const clippedTranslation = clipTranslationAgainstBoardEdge(
        translation.x,
        translation.y,
        inwardNormal,
        getPointBoardClearance(srj, point),
        edgeProximityThreshold,
      )

      if (
        Math.abs(clippedTranslation.x - translation.x) > POSITION_EPSILON ||
        Math.abs(clippedTranslation.y - translation.y) > POSITION_EPSILON
      ) {
        translation = clippedTranslation
        changed = true
      }
    }

    if (!changed) break
  }

  return translation
}

const getRoutePointIndexesMinBoardClearance = (
  srj: SimpleRouteJson,
  route: MutableRoute,
  pointIndexes: number[],
  translatedPoints?: Map<number, Point>,
) => {
  const uniquePointIndexes = [...new Set(pointIndexes)].sort(
    (left, right) => left - right,
  )
  if (uniquePointIndexes.length === 0) return Number.POSITIVE_INFINITY

  const movedPointIndexes = new Set(uniquePointIndexes)
  const getPoint = (pointIndex: number) =>
    translatedPoints?.get(pointIndex) ?? route.route[pointIndex]

  let minClearance = Number.POSITIVE_INFINITY

  for (const pointIndex of uniquePointIndexes) {
    const point = getPoint(pointIndex)
    if (!point) continue
    minClearance = Math.min(minClearance, getPointBoardClearance(srj, point))
  }

  for (
    let pointIndex = 0;
    pointIndex < route.route.length - 1;
    pointIndex += 1
  ) {
    if (
      !movedPointIndexes.has(pointIndex) &&
      !movedPointIndexes.has(pointIndex + 1)
    ) {
      continue
    }

    const start = getPoint(pointIndex)
    const end = getPoint(pointIndex + 1)
    if (!start || !end) continue
    minClearance = Math.min(
      minClearance,
      getSegmentBoardClearance(srj, start, end),
    )
  }

  return minClearance
}

export const getFrozenSafeTranslationForPointIndexes = (
  srj: SimpleRouteJson,
  route: MutableRoute,
  pointIndexes: number[],
  dx: number,
  dy: number,
  featureRadius: number,
) => {
  const sortedPointIndexes = [...new Set(pointIndexes)].sort(
    (left, right) => left - right,
  )
  if (sortedPointIndexes.length === 0) return undefined
  const translation = clipPointIndexesTranslationAwayFromBoardEdge(
    srj,
    route,
    sortedPointIndexes,
    dx,
    dy,
    featureRadius,
  )
  if (
    Math.abs(translation.x) <= POSITION_EPSILON &&
    Math.abs(translation.y) <= POSITION_EPSILON
  ) {
    return undefined
  }
  const translatedPoints = new Map<number, Point>()

  for (const pointIndex of sortedPointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue

    const translatedPoint = {
      x: point.x + translation.x,
      y: point.y + translation.y,
    }
    translatedPoints.set(pointIndex, translatedPoint)
  }

  const currentMinClearance = getRoutePointIndexesMinBoardClearance(
    srj,
    route,
    sortedPointIndexes,
  )
  const translatedMinClearance = getRoutePointIndexesMinBoardClearance(
    srj,
    route,
    sortedPointIndexes,
    translatedPoints,
  )

  if (translatedMinClearance < featureRadius - COORDINATE_EPSILON) {
    return undefined
  }

  const edgeProximityThreshold = getBoardEdgeProximityThreshold(
    srj,
    featureRadius,
  )
  if (
    moveReducesClearanceIntoBoardEdgeZone(
      currentMinClearance,
      translatedMinClearance,
      edgeProximityThreshold,
    )
  ) {
    return undefined
  }

  return translation
}
