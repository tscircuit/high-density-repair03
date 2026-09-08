import {
  getMovingPointRectangleContact,
  getPointRectangleSignedDistance,
  type Rectangle,
} from "./getMovingPointRectangleContact"
import { getMovingPointSegmentContact } from "./getMovingPointSegmentContact"

type Point = { x: number; y: number }

type Segment = {
  start: Point
  end: Point
  z: number
  traceRadius: number
  rootConnectionName: string
  clearance?: number
  pointAliases?: Point[]
  rectangle?: Rectangle
  sameNetRoots?: Set<string>
}

const cross = (ax: number, ay: number, bx: number, by: number): number =>
  ax * by - ay * bx

const pointDistanceSquared = (
  point: Point,
  start: Point,
  end: Point,
): number => {
  const dx = end.x - start.x,
    dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        )
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
}

const segmentDistanceSquared = (
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number => {
  const cdA = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y)
  const cdB = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y)
  const abC = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)
  const abD = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y)
  if (cdA * cdB < 0 && abC * abD < 0) return 0
  return Math.min(
    pointDistanceSquared(a, c, d),
    pointDistanceSquared(b, c, d),
    pointDistanceSquared(c, a, b),
    pointDistanceSquared(d, a, b),
  )
}

/**
 * A force step must not change trace ordering or worsen existing penetration.
 * First-contact events preserve trace copper and via annulus clearance. Signed
 * pad distances let an embedded via escape without moving deeper into copper.
 * Points at a shared physical site are checked together before moving.
 */
export class TraceSegmentMoveGuard {
  private readonly originalPoints = new Map<Point, Point>()
  private readonly pairClearance = new Map<Segment, Map<Segment, number>>()
  private readonly segmentsByPoint = new Map<Point, Segment[]>()
  private readonly cells = new Map<string, Set<Segment>>()
  private readonly cellKeysBySegment = new Map<Segment, string[]>()
  private readonly pendingUpdates = new Set<Segment>()
  private readonly cellSize: number
  private readonly maxTraceRadius: number
  private readonly maxClearance: number

  constructor(
    segments: Segment[],
    private readonly epsilon = 2e-6,
  ) {
    this.maxTraceRadius = segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.traceRadius),
      0,
    )
    this.maxClearance = segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.clearance ?? 0),
      0,
    )
    this.cellSize = Math.max(1, this.maxTraceRadius * 4)
    for (const segment of segments) {
      const points = new Set([
        segment.start,
        segment.end,
        ...(segment.pointAliases ?? []),
      ])
      for (const point of points) {
        this.originalPoints.set(point, { x: point.x, y: point.y })
        const adjacent = this.segmentsByPoint.get(point) ?? []
        adjacent.push(segment)
        this.segmentsByPoint.set(point, adjacent)
      }
      this.updateSegmentIndex(segment)
    }
  }

  private updateSegmentIndex(segment: Segment): void {
    for (const key of this.cellKeysBySegment.get(segment) ?? []) {
      const cell = this.cells.get(key)!
      cell.delete(segment)
      if (cell.size === 0) this.cells.delete(key)
    }
    const keys: string[] = []
    const minX = Math.floor(
      Math.min(segment.start.x, segment.end.x) / this.cellSize,
    )
    const maxX = Math.floor(
      Math.max(segment.start.x, segment.end.x) / this.cellSize,
    )
    const minY = Math.floor(
      Math.min(segment.start.y, segment.end.y) / this.cellSize,
    )
    const maxY = Math.floor(
      Math.max(segment.start.y, segment.end.y) / this.cellSize,
    )
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${segment.z}:${x}:${y}`
        let cell = this.cells.get(key)
        if (!cell) {
          cell = new Set()
          this.cells.set(key, cell)
        }
        cell.add(segment)
        keys.push(key)
      }
    }
    this.cellKeysBySegment.set(segment, keys)
  }

  private getNearbySegments(
    z: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): Set<Segment> {
    const nearby = new Set<Segment>()
    for (
      let x = Math.floor(minX / this.cellSize);
      x <= Math.floor(maxX / this.cellSize);
      x += 1
    ) {
      for (
        let y = Math.floor(minY / this.cellSize);
        y <= Math.floor(maxY / this.cellSize);
        y += 1
      ) {
        for (const segment of this.cells.get(`${z}:${x}:${y}`) ?? []) {
          nearby.add(segment)
        }
      }
    }
    return nearby
  }

  constrain(points: Point[], dx: number, dy: number): Point {
    for (const segment of this.pendingUpdates) this.updateSegmentIndex(segment)
    this.pendingUpdates.clear()
    const length = Math.hypot(dx, dy)
    if (length === 0) return { x: 0, y: 0 }
    const movedPoints = new Set(points)
    const adjacent = new Set(
      points.flatMap((point) => this.segmentsByPoint.get(point) ?? []),
    )
    const clearancePairs: Array<{
      segment: Segment
      obstacle: Segment
      minDistanceSquared: number
    }> = []
    const rectanglePairs: Array<{
      point: Point
      rectangle: Rectangle
      minDistance: number
    }> = []
    let firstContact = Number.POSITIVE_INFINITY
    for (const segment of adjacent) {
      const moveStart = movedPoints.has(segment.start)
      const moveEnd = movedPoints.has(segment.end)
      const ax = segment.start.x
      const ay = segment.start.y
      const bx = segment.end.x
      const by = segment.end.y
      const minX = Math.min(
        ax,
        bx,
        ax + (moveStart ? dx : 0),
        bx + (moveEnd ? dx : 0),
      )
      const maxX = Math.max(
        ax,
        bx,
        ax + (moveStart ? dx : 0),
        bx + (moveEnd ? dx : 0),
      )
      const minY = Math.min(
        ay,
        by,
        ay + (moveStart ? dy : 0),
        by + (moveEnd ? dy : 0),
      )
      const maxY = Math.max(
        ay,
        by,
        ay + (moveStart ? dy : 0),
        by + (moveEnd ? dy : 0),
      )
      const searchRadius =
        segment.traceRadius + this.maxTraceRadius + this.maxClearance
      for (const obstacle of this.getNearbySegments(
        segment.z,
        minX - searchRadius,
        maxX + searchRadius,
        minY - searchRadius,
        maxY + searchRadius,
      )) {
        if (obstacle.rectangle) {
          if (!segment.pointAliases) continue
          const rectangle = obstacle.rectangle
          let cached = this.pairClearance.get(segment)
          if (!cached) {
            cached = new Map()
            this.pairClearance.set(segment, cached)
          }
          let minDistance = cached.get(obstacle)
          if (minDistance === undefined) {
            const originalDistance = getPointRectangleSignedDistance(
              this.originalPoints.get(segment.start)!,
              rectangle,
            )
            const clearance = obstacle.sameNetRoots?.has(
              segment.rootConnectionName,
            )
              ? 0
              : (obstacle.clearance ?? 0)
            minDistance =
              Math.min(segment.traceRadius + clearance, originalDistance) -
              this.epsilon
            cached.set(obstacle, minDistance)
          }
          rectanglePairs.push({ point: segment.start, rectangle, minDistance })
          firstContact = Math.min(
            firstContact,
            getMovingPointRectangleContact(
              segment.start,
              { x: dx, y: dy },
              rectangle,
              minDistance,
            ),
          )
          continue
        }
        if (segment.rootConnectionName === obstacle.rootConnectionName) continue
        const c = obstacle.start
        const d = obstacle.end
        const radius =
          segment.traceRadius +
          obstacle.traceRadius +
          Math.max(segment.clearance ?? 0, obstacle.clearance ?? 0)
        if (
          radius > 0 &&
          Math.max(c.x, d.x) + radius >= minX &&
          Math.min(c.x, d.x) - radius <= maxX &&
          Math.max(c.y, d.y) + radius >= minY &&
          Math.min(c.y, d.y) - radius <= maxY
        ) {
          let cached = this.pairClearance.get(segment)
          if (!cached) {
            cached = new Map()
            this.pairClearance.set(segment, cached)
          }
          let minDistanceSquared = cached.get(obstacle)
          if (minDistanceSquared === undefined) {
            const originalDistance = Math.sqrt(
              segmentDistanceSquared(
                this.originalPoints.get(segment.start)!,
                this.originalPoints.get(segment.end)!,
                this.originalPoints.get(c)!,
                this.originalPoints.get(d)!,
              ),
            )
            minDistanceSquared =
              Math.max(0, Math.min(radius, originalDistance) - this.epsilon) **
              2
            cached.set(obstacle, minDistanceSquared)
          }
          clearancePairs.push({ segment, obstacle, minDistanceSquared })
          if (
            segment.clearance !== undefined ||
            obstacle.clearance !== undefined
          ) {
            const displacement = (point: Point): Point =>
              movedPoints.has(point) ? { x: dx, y: dy } : { x: 0, y: 0 }
            const contactRadius = Math.sqrt(minDistanceSquared)
            for (const point of [segment.start, segment.end]) {
              firstContact = Math.min(
                firstContact,
                getMovingPointSegmentContact(
                  point,
                  c,
                  d,
                  displacement(point),
                  displacement(c),
                  displacement(d),
                  contactRadius,
                ),
              )
            }
            for (const point of [c, d]) {
              firstContact = Math.min(
                firstContact,
                getMovingPointSegmentContact(
                  point,
                  segment.start,
                  segment.end,
                  displacement(point),
                  displacement(segment.start),
                  displacement(segment.end),
                  contactRadius,
                ),
              )
            }
          }
        }
        if (
          Math.max(c.x, d.x) < minX ||
          Math.min(c.x, d.x) > maxX ||
          Math.max(c.y, d.y) < minY ||
          Math.min(c.y, d.y) > maxY
        )
          continue
        // With one vertex (or both by the same displacement) moving, each
        // endpoint/segment contact is a root of a linear orientation function.
        const testContact = (
          offset: number,
          rate: number,
          movingEndpoint?: Point,
          fixedEndpoint?: Point,
        ): void => {
          if (rate === 0) return
          const t = -offset / rate
          if (t <= 1e-12 || t > Math.min(firstContact, 1)) return
          let start: Point, end: Point, point: Point
          if (movingEndpoint) {
            start = c
            end = d
            point = {
              x: movingEndpoint.x + dx * t,
              y: movingEndpoint.y + dy * t,
            }
          } else {
            start = {
              x: ax + (moveStart ? dx * t : 0),
              y: ay + (moveStart ? dy * t : 0),
            }
            end = {
              x: bx + (moveEnd ? dx * t : 0),
              y: by + (moveEnd ? dy * t : 0),
            }
            point = fixedEndpoint!
          }
          const sx = end.x - start.x
          const sy = end.y - start.y
          const dot = (point.x - start.x) * sx + (point.y - start.y) * sy
          if (dot >= 0 && dot <= sx * sx + sy * sy) firstContact = t
        }
        for (const point of [segment.start, segment.end]) {
          if (!movedPoints.has(point)) continue
          testContact(
            cross(d.x - c.x, d.y - c.y, point.x - c.x, point.y - c.y),
            cross(d.x - c.x, d.y - c.y, dx, dy),
            point,
          )
        }
        const startDx = moveStart ? dx : 0
        const startDy = moveStart ? dy : 0
        const edgeDx = (moveEnd ? dx : 0) - startDx
        const edgeDy = (moveEnd ? dy : 0) - startDy
        for (const point of [c, d]) {
          testContact(
            cross(bx - ax, by - ay, point.x - ax, point.y - ay),
            cross(edgeDx, edgeDy, point.x - ax, point.y - ay) -
              cross(bx - ax, by - ay, startDx, startDy),
            undefined,
            point,
          )
        }
      }
    }
    let scale =
      firstContact <= 1 ? Math.max(0, firstContact - this.epsilon / length) : 1
    const hasClearance = (t: number): boolean => {
      for (const { point, rectangle, minDistance } of rectanglePairs) {
        if (
          getPointRectangleSignedDistance(
            { x: point.x + dx * t, y: point.y + dy * t },
            rectangle,
          ) < minDistance
        )
          return false
      }
      for (const { segment, obstacle, minDistanceSquared } of clearancePairs) {
        const a = movedPoints.has(segment.start)
          ? { x: segment.start.x + dx * t, y: segment.start.y + dy * t }
          : segment.start
        const b = movedPoints.has(segment.end)
          ? { x: segment.end.x + dx * t, y: segment.end.y + dy * t }
          : segment.end
        if (
          segmentDistanceSquared(a, b, obstacle.start, obstacle.end) <
          minDistanceSquared
        )
          return false
      }
      return true
    }
    // The accepted lower bound is checked against every nearby segment;
    // stopping at coordinate precision does not depend on an iteration budget.
    if (!hasClearance(scale)) {
      let lo = 0,
        hi = scale
      while ((hi - lo) * length > this.epsilon) {
        const mid = (lo + hi) / 2
        if (hasClearance(mid)) lo = mid
        else hi = mid
      }
      scale = lo
    }
    // Callers apply the returned displacement after validating board bounds.
    // Refresh from the actual points at the next query, including rejected moves.
    for (const segment of adjacent) this.pendingUpdates.add(segment)
    return { x: dx * scale, y: dy * scale }
  }
}
