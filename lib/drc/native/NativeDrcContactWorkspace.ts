import {
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { NativeDrcPoint } from "./nativeDrcTypes"

type PointIdentity = { id: number; x: number; y: number }

/**
 * One immutable candidate's pure geometry results. Directed endpoint order and
 * radius are part of each key: no width, connectivity, threshold or error is
 * shared between the indexed objective and the reference validation rules.
 */
export class NativeDrcContactWorkspace {
  private readonly pointIdentities = new WeakMap<
    NativeDrcPoint,
    PointIdentity
  >()
  private readonly pointIds = new Map<string, Map<string, number>>()
  private readonly segmentIds = new Map<number, Map<number, number>>()
  private readonly segmentDistances = new Map<number, Map<number, number>>()
  private readonly circleDistances = new Map<
    number,
    Map<number, Map<number | string, number>>
  >()
  private pointCount = 0
  private segmentCount = 0
  readonly stats = {
    segmentKernelCalls: 0,
    segmentCacheHits: 0,
    circleKernelCalls: 0,
    circleCacheHits: 0,
  }

  private getPointId(point: NativeDrcPoint): number {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error("Non-finite native DRC contact coordinate")
    const known = this.pointIdentities.get(point)
    if (known && Object.is(known.x, point.x) && Object.is(known.y, point.y))
      return known.id
    // Number's shortest string is injective for finite binary64; preserve -0.
    const x = Object.is(point.x, -0) ? "-0" : String(point.x)
    const y = Object.is(point.y, -0) ? "-0" : String(point.y)
    let column = this.pointIds.get(x)
    if (!column) {
      column = new Map()
      this.pointIds.set(x, column)
    }
    let id = column.get(y)
    if (id === undefined) {
      id = this.pointCount++
      column.set(y, id)
    }
    this.pointIdentities.set(point, { id, x: point.x, y: point.y })
    return id
  }

  private getSegmentId(start: NativeDrcPoint, end: NativeDrcPoint): number {
    const startId = this.getPointId(start)
    const endId = this.getPointId(end)
    let ends = this.segmentIds.get(startId)
    if (!ends) {
      ends = new Map()
      this.segmentIds.set(startId, ends)
    }
    let id = ends.get(endId)
    if (id === undefined) {
      id = this.segmentCount++
      ends.set(endId, id)
    }
    return id
  }

  segmentDistance(
    a1: NativeDrcPoint,
    a2: NativeDrcPoint,
    b1: NativeDrcPoint,
    b2: NativeDrcPoint,
  ): number {
    const a = this.getSegmentId(a1, a2)
    const b = this.getSegmentId(b1, b2)
    let distances = this.segmentDistances.get(a)
    if (!distances) {
      distances = new Map()
      this.segmentDistances.set(a, distances)
    }
    const known = distances.get(b)
    if (known !== undefined) {
      this.stats.segmentCacheHits++
      return known
    }
    const distance = segmentToSegmentMinDistance(a1, a2, b1, b2)
    this.stats.segmentKernelCalls++
    distances.set(b, distance)
    return distance
  }

  circleDistance(
    start: NativeDrcPoint,
    end: NativeDrcPoint,
    circle: NativeDrcPoint & { radius: number },
  ): number {
    if (!Number.isFinite(circle.radius) || circle.radius < 0)
      throw new Error("Invalid native DRC contact radius")
    const segment = this.getSegmentId(start, end)
    const center = this.getPointId(circle)
    let centers = this.circleDistances.get(segment)
    if (!centers) {
      centers = new Map()
      this.circleDistances.set(segment, centers)
    }
    let radii = centers.get(center)
    if (!radii) {
      radii = new Map()
      centers.set(center, radii)
    }
    const radius = Object.is(circle.radius, -0) ? "-0" : circle.radius
    const known = radii.get(radius)
    if (known !== undefined) {
      this.stats.circleCacheHits++
      return known
    }
    const distance = segmentToCircleMinDistance(start, end, circle)
    this.stats.circleKernelCalls++
    radii.set(radius, distance)
    return distance
  }
}
