import {
  getSegmentIntersection,
  isPointInsidePolygon,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { Box, Point, Polygon, Segment } from "@flatten-js/core"
import type { NativeDrcContactWorkspace } from "./NativeDrcContactWorkspace"
import type {
  NativeDrcBounds,
  NativeDrcHole,
  NativeDrcPad,
  NativeDrcPoint,
  NativeDrcSegment,
  NativeDrcVia,
  PreparedNativeDrcHole,
  PreparedNativeDrcPad,
} from "./nativeDrcTypes"

export interface NativeDrcClearance {
  gap: number
  center: NativeDrcPoint
}

function getGridRange(
  bounds: NativeDrcBounds,
  margin = 0,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY ||
    !Number.isFinite(margin) ||
    margin < 0
  )
    throw new Error("Invalid native DRC grid bounds or margin")
  const range = {
    minX: Math.floor((bounds.minX - margin) / 0.4),
    minY: Math.floor((bounds.minY - margin) / 0.4),
    maxX: Math.floor((bounds.maxX + margin) / 0.4),
    maxY: Math.floor((bounds.maxY + margin) / 0.4),
  }
  if (!Object.values(range).every(Number.isSafeInteger))
    throw new Error(
      "Native DRC grid cell bounds are outside the supported integer range",
    )
  return range
}

/** Same cell visitation/insertion order as the reference index, without clones. */
export class NativeDrcGrid<T extends object> {
  readonly cells = new Map<number, Map<number, T[]>>()
  readonly cellSize = 0.4

  constructor(objects: T[], getBounds: (object: T) => NativeDrcBounds) {
    for (const object of objects) {
      const bounds = getBounds(object)
      const range = getGridRange(bounds)
      for (let bx = range.minX; bx <= range.maxX; bx++) {
        let column = this.cells.get(bx)
        if (!column) {
          column = new Map()
          this.cells.set(bx, column)
        }
        for (let by = range.minY; by <= range.maxY; by++) {
          const bucket = column.get(by)
          if (bucket) bucket.push(object)
          else column.set(by, [object])
        }
      }
    }
  }

  query(
    bounds: NativeDrcBounds,
    margin = 0,
    getId?: (object: T) => unknown,
  ): T[] {
    return queryNativeDrcGrids(bounds, margin, [this], getId)
  }
}

/** Static geometry stays indexed; per-cell concatenation preserves rule order. */
export function queryNativeDrcGrids<T extends object>(
  bounds: NativeDrcBounds,
  margin: number,
  grids: NativeDrcGrid<T>[],
  getId?: (object: T) => unknown,
): T[] {
  const range = getGridRange(bounds, margin)
  const result: T[] = []
  const seen = new Set<unknown>()
  for (let bx = range.minX; bx <= range.maxX; bx++) {
    for (let by = range.minY; by <= range.maxY; by++) {
      for (const grid of grids) {
        const bucket = grid.cells.get(bx)?.get(by)
        if (!bucket) continue
        for (const object of bucket) {
          const identity = getId ? getId(object) : object
          if (seen.has(identity)) continue
          seen.add(identity)
          result.push(object)
        }
      }
    }
  }
  return result
}

export function getNativeSegmentBounds(
  start: NativeDrcPoint,
  end: NativeDrcPoint,
): NativeDrcBounds {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  }
}

export function prepareNativeDrcPad(pad: NativeDrcPad): PreparedNativeDrcPad {
  const radians = ((pad.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const polygon = [
    { x: -pad.width / 2, y: -pad.height / 2 },
    { x: pad.width / 2, y: -pad.height / 2 },
    { x: pad.width / 2, y: pad.height / 2 },
    { x: -pad.width / 2, y: pad.height / 2 },
  ].map((point) => ({
    x: pad.x + (point.x * cos - point.y * sin),
    y: pad.y + (point.x * sin + point.y * cos),
  }))
  const bounds =
    pad.shape === "circle"
      ? {
          minX: pad.x - pad.radius!,
          minY: pad.y - pad.radius!,
          maxX: pad.x + pad.radius!,
          maxY: pad.y + pad.radius!,
        }
      : {
          minX: Math.min(...polygon.map((point) => point.x)),
          minY: Math.min(...polygon.map((point) => point.y)),
          maxX: Math.max(...polygon.map((point) => point.x)),
          maxY: Math.max(...polygon.map((point) => point.y)),
        }
  return { ...pad, layers: [...pad.layers], polygon, bounds }
}

export function pointInNativePad(
  point: NativeDrcPoint,
  pad: PreparedNativeDrcPad,
): boolean {
  if (pad.shape === "circle")
    return (
      Math.sqrt((point.x - pad.x) ** 2 + (point.y - pad.y) ** 2) <=
      pad.radius! + 1e-9
    )
  if (pad.kind === "smtpad" && pad.rotation === undefined)
    return (
      Math.abs(point.x - pad.x) <= pad.width / 2 + 1e-9 &&
      Math.abs(point.y - pad.y) <= pad.height / 2 + 1e-9
    )
  let inside = false
  const polygon = pad.polygon
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!
    const cross =
      (point.y - pi.y) * (pj.x - pi.x) - (point.x - pi.x) * (pj.y - pi.y)
    const dot =
      (point.x - pi.x) * (pj.x - pi.x) + (point.y - pi.y) * (pj.y - pi.y)
    const lengthSquared = (pj.x - pi.x) ** 2 + (pj.y - pi.y) ** 2
    if (Math.abs(cross) <= 1e-9 && dot >= -1e-9 && dot <= lengthSquared + 1e-9)
      return true
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    if (intersects) inside = !inside
  }
  return inside
}

function closestSegmentPoints(
  a1: NativeDrcPoint,
  a2: NativeDrcPoint,
  b1: NativeDrcPoint,
  b2: NativeDrcPoint,
): { distance: number; pointOnA: NativeDrcPoint; pointOnB: NativeDrcPoint } {
  const intersection = getSegmentIntersection(a1, a2, b1, b2)
  if (intersection)
    return { distance: 0, pointOnA: intersection, pointOnB: intersection }
  const candidates = [
    { pointOnA: a1, pointOnB: pointToSegmentClosestPoint(a1, b1, b2) },
    { pointOnA: a2, pointOnB: pointToSegmentClosestPoint(a2, b1, b2) },
    { pointOnA: pointToSegmentClosestPoint(b1, a1, a2), pointOnB: b1 },
    { pointOnA: pointToSegmentClosestPoint(b2, a1, a2), pointOnB: b2 },
  ]
  let best = candidates[0]!
  let bestDistanceSquared =
    (best.pointOnA.x - best.pointOnB.x) ** 2 +
    (best.pointOnA.y - best.pointOnB.y) ** 2
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const distanceSquared =
      (candidate.pointOnA.x - candidate.pointOnB.x) ** 2 +
      (candidate.pointOnA.y - candidate.pointOnB.y) ** 2
    if (distanceSquared < bestDistanceSquared) {
      best = candidate
      bestDistanceSquared = distanceSquared
    }
  }
  return { distance: segmentToSegmentMinDistance(a1, a2, b1, b2), ...best }
}

function getCenterBetweenCopperEdges(
  tracePoint: NativeDrcPoint,
  obstaclePoint: NativeDrcPoint,
  traceRadius: number,
  obstacleRadius: number,
): NativeDrcPoint {
  const dx = obstaclePoint.x - tracePoint.x
  const dy = obstaclePoint.y - tracePoint.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0)
    return {
      x: (tracePoint.x + obstaclePoint.x) / 2,
      y: (tracePoint.y + obstaclePoint.y) / 2,
    }
  const unitX = dx / distance
  const unitY = dy / distance
  if (distance <= traceRadius + obstacleRadius) {
    const offset =
      (Math.max(-traceRadius, distance - obstacleRadius) +
        Math.min(traceRadius, distance + obstacleRadius)) /
      2
    return {
      x: tracePoint.x + unitX * offset,
      y: tracePoint.y + unitY * offset,
    }
  }
  const traceEdge = {
    x: tracePoint.x + unitX * traceRadius,
    y: tracePoint.y + unitY * traceRadius,
  }
  const obstacleEdge = {
    x: obstaclePoint.x - unitX * obstacleRadius,
    y: obstaclePoint.y - unitY * obstacleRadius,
  }
  return {
    x: (traceEdge.x + obstacleEdge.x) / 2,
    y: (traceEdge.y + obstacleEdge.y) / 2,
  }
}

export function getNativePadClearance(
  segment: Pick<NativeDrcSegment, "start" | "end" | "width">,
  obstacle: PreparedNativeDrcPad | NativeDrcVia,
  contacts?: NativeDrcContactWorkspace,
): NativeDrcClearance {
  const start = segment.start
  const end = segment.end
  const traceRadius = segment.width / 2
  if ("diameter" in obstacle || obstacle.shape === "circle") {
    const circle = {
      x: obstacle.x,
      y: obstacle.y,
      radius: "diameter" in obstacle ? obstacle.diameter / 2 : obstacle.radius!,
    }
    const closestPoint = pointToSegmentClosestPoint(circle, start, end)
    const distance = contacts
      ? contacts.circleDistance(start, end, circle)
      : segmentToCircleMinDistance(start, end, circle)
    return {
      gap: distance - traceRadius,
      center: getCenterBetweenCopperEdges(
        closestPoint,
        circle,
        traceRadius,
        circle.radius,
      ),
    }
  }
  const polygon = obstacle.polygon
  const intersections: NativeDrcPoint[] = []
  for (let i = 0; i < polygon.length; i++) {
    const intersection = getSegmentIntersection(
      start,
      end,
      polygon[i]!,
      polygon[(i + 1) % polygon.length]!,
    )
    if (intersection) intersections.push(intersection)
  }
  if (intersections.length > 0) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    intersections.sort(
      (a, b) =>
        ((a.x - start.x) * dx + (a.y - start.y) * dy) / lengthSquared -
        ((b.x - start.x) * dx + (b.y - start.y) * dy) / lengthSquared,
    )
    return { gap: -traceRadius, center: intersections[0]! }
  }
  if (
    isPointInsidePolygon(start, polygon) ||
    isPointInsidePolygon(end, polygon)
  )
    return {
      gap: -traceRadius,
      center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    }
  let best = closestSegmentPoints(start, end, polygon[0]!, polygon[1]!)
  for (let i = 1; i < polygon.length; i++) {
    const candidate = closestSegmentPoints(
      start,
      end,
      polygon[i]!,
      polygon[(i + 1) % polygon.length]!,
    )
    if (candidate.distance < best.distance) best = candidate
  }
  return {
    gap: best.distance - traceRadius,
    center: getCenterBetweenCopperEdges(
      best.pointOnA,
      best.pointOnB,
      traceRadius,
      0,
    ),
  }
}

export function prepareNativeDrcHole(
  hole: NativeDrcHole,
): PreparedNativeDrcHole {
  const width = hole.shape === "circle" ? hole.diameter! : hole.width!
  const height = hole.shape === "circle" ? hole.diameter! : hole.height!
  return {
    ...hole,
    kind: "hole",
    bounds: {
      minX: hole.x - width / 2,
      minY: hole.y - height / 2,
      maxX: hole.x + width / 2,
      maxY: hole.y + height / 2,
    },
  }
}

const holePolygonCache = new WeakMap<PreparedNativeDrcHole, Polygon>()

export function getNativeHoleClearance(
  segment: NativeDrcSegment,
  hole: PreparedNativeDrcHole,
): NativeDrcClearance {
  const a = new Point(segment.start.x, segment.start.y)
  const b = new Point(segment.end.x, segment.end.y)
  let center: NativeDrcPoint = pointToSegmentClosestPoint(hole, a, b)
  if (hole.shape === "circle")
    return {
      gap:
        pointToSegmentDistance(hole, a, b) -
        hole.diameter! / 2 -
        segment.width / 2,
      center,
    }
  let polygon = holePolygonCache.get(hole)
  if (!polygon) {
    const bounds = hole.bounds
    polygon = new Polygon(
      new Box(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
    )
    holePolygonCache.set(hole, polygon)
  }
  const [boundaryDistance, shortest] = polygon.distanceTo(new Segment(a, b))
  const distance =
    polygon.contains(a) || polygon.contains(b) ? 0 : boundaryDistance
  center = shortest.end
  return { gap: distance - segment.width / 2, center }
}

/** The overlap checker uses its own closest-point tie breaking. */
export function getNativeTracePairCenter(
  a: NativeDrcSegment,
  b: NativeDrcSegment,
): NativeDrcPoint {
  const a1 = a.start
  const a2 = a.end
  const b1 = b.start
  const b2 = b.end
  const va = { x: a2.x - a1.x, y: a2.y - a1.y }
  const vb = { x: b2.x - b1.x, y: b2.y - b1.y }
  const dotAA = va.x * va.x + va.y * va.y
  const dotBB = vb.x * vb.x + vb.y * vb.y
  const clamp = (value: number): number => Math.max(0, Math.min(1, value))
  if (dotAA === 0 || dotBB === 0) {
    const pointA = dotAA === 0 ? a1 : pointToSegmentClosestPoint(b1, a1, a2)
    const pointB = dotBB === 0 ? b1 : pointToSegmentClosestPoint(a1, b1, b2)
    return { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 }
  }
  const w = { x: a1.x - b1.x, y: a1.y - b1.y }
  const dotAB = va.x * vb.x + va.y * vb.y
  const dotAW = va.x * w.x + va.y * w.y
  const dotBW = vb.x * w.x + vb.y * w.y
  const denominator = dotAA * dotBB - dotAB * dotAB
  if (denominator < 1e-10) {
    const candidates = [
      { a: pointToSegmentClosestPoint(b1, a1, a2), b: b1 },
      { a: pointToSegmentClosestPoint(b2, a1, a2), b: b2 },
      { a: a1, b: pointToSegmentClosestPoint(a1, b1, b2) },
      { a: a2, b: pointToSegmentClosestPoint(a2, b1, b2) },
    ]
    let best = candidates[0]!
    let distance = Math.sqrt(
      (best.a.x - best.b.x) ** 2 + (best.a.y - best.b.y) ** 2,
    )
    for (const candidate of candidates.slice(1)) {
      const nextDistance = Math.sqrt(
        (candidate.a.x - candidate.b.x) ** 2 +
          (candidate.a.y - candidate.b.y) ** 2,
      )
      if (nextDistance < distance) {
        best = candidate
        distance = nextDistance
      }
    }
    return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 }
  }
  let tA = clamp((dotAB * dotBW - dotBB * dotAW) / denominator)
  let tB = clamp((dotAA * dotBW - dotAB * dotAW) / denominator)
  tB = clamp((tA * dotAB + dotBW) / dotBB)
  tA = clamp((tB * dotAB - dotAW) / dotAA)
  return {
    x: (a1.x + tA * va.x + (b1.x + tB * vb.x)) / 2,
    y: (a1.y + tA * va.y + (b1.y + tB * vb.y)) / 2,
  }
}
