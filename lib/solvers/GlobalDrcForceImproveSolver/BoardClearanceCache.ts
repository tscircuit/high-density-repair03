import type { SimpleRouteJson } from "../../types"
import type { Point } from "./internalTypes"

type PointClearance = {
  x: number
  y: number
  clearance: number | undefined
  inwardNormal: Point | undefined
  hasInwardNormal: boolean
}
type SegmentClearance = {
  startX: number
  startY: number
  endX: number
  endY: number
  clearance: number | undefined
}

/** Geometry-keyed memoization; mutable route points never serve as identity-only keys. */
export class BoardClearanceCache {
  private static readonly boards = new WeakMap<
    SimpleRouteJson,
    BoardClearanceCache
  >()
  private readonly outline: SimpleRouteJson["outline"]
  private readonly outlineCoordinates: Point[]
  private readonly bounds: SimpleRouteJson["bounds"]
  private readonly points = new WeakMap<Point, PointClearance>()
  private readonly segments = new WeakMap<
    Point,
    WeakMap<Point, SegmentClearance>
  >()

  private constructor(srj: SimpleRouteJson) {
    this.outline = srj.outline
    this.outlineCoordinates = srj.outline
      ? srj.outline.map(({ x, y }) => ({ x, y }))
      : []
    this.bounds = { ...srj.bounds }
  }

  private matches(srj: SimpleRouteJson): boolean {
    if (
      this.outline !== srj.outline ||
      !Object.is(this.bounds.minX, srj.bounds.minX) ||
      !Object.is(this.bounds.minY, srj.bounds.minY) ||
      !Object.is(this.bounds.maxX, srj.bounds.maxX) ||
      !Object.is(this.bounds.maxY, srj.bounds.maxY) ||
      this.outlineCoordinates.length !== (srj.outline?.length ?? 0)
    )
      return false
    for (let i = 0; i < this.outlineCoordinates.length; i++) {
      const previous = this.outlineCoordinates[i]!
      const current = srj.outline![i]!
      if (
        !Object.is(previous.x, current.x) ||
        !Object.is(previous.y, current.y)
      )
        return false
    }
    return true
  }

  static forBoard(srj: SimpleRouteJson): BoardClearanceCache {
    let cache = this.boards.get(srj)
    if (!cache || !cache.matches(srj)) {
      cache = new BoardClearanceCache(srj)
      this.boards.set(srj, cache)
    }
    return cache
  }

  getPoint(point: Point): PointClearance {
    let cached = this.points.get(point)
    if (!cached) {
      cached = {
        x: point.x,
        y: point.y,
        clearance: undefined,
        inwardNormal: undefined,
        hasInwardNormal: false,
      }
      this.points.set(point, cached)
    } else if (!Object.is(cached.x, point.x) || !Object.is(cached.y, point.y)) {
      cached.x = point.x
      cached.y = point.y
      cached.clearance = undefined
      cached.inwardNormal = undefined
      cached.hasInwardNormal = false
    }
    return cached
  }

  getSegment(start: Point, end: Point): SegmentClearance {
    let byEnd = this.segments.get(start)
    if (!byEnd) {
      byEnd = new WeakMap()
      this.segments.set(start, byEnd)
    }
    let cached = byEnd.get(end)
    if (!cached) {
      cached = {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        clearance: undefined,
      }
      byEnd.set(end, cached)
    } else if (
      !Object.is(cached.startX, start.x) ||
      !Object.is(cached.startY, start.y) ||
      !Object.is(cached.endX, end.x) ||
      !Object.is(cached.endY, end.y)
    ) {
      cached.startX = start.x
      cached.startY = start.y
      cached.endX = end.x
      cached.endY = end.y
      cached.clearance = undefined
    }
    return cached
  }
}
