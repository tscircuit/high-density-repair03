import {
  Arc,
  Box,
  Circle,
  ORIENTATION,
  Point,
  Polygon,
  Segment,
} from "@flatten-js/core"
import type { Edge } from "@flatten-js/core"
import type { NativeDrcVia, NativeDrcWire } from "./nativeDrcTypes"

type CopperGeometry = {
  box: Box
  facePoints: Point[]
  edges: Array<Arc | Segment>
  edgeIndex: Polygon["edges"]
}

/**
 * Physical continuity's established scaled arc/contact kernel. Copper is built
 * lazily for broad-phase candidates instead of converting every board segment.
 */
export function createNativeDrcCopperContactTester(): {
  viaTouchesSegment(
    via: NativeDrcVia,
    start: NativeDrcWire,
    end: NativeDrcWire,
  ): boolean
  viasTouch(a: NativeDrcVia, b: NativeDrcVia): boolean
} {
  const scale = 1e6
  const tolerance = 1e-7 * scale
  const geometryCache = new WeakMap<Polygon, CopperGeometry>()
  const viaPolygons = new WeakMap<NativeDrcVia, Polygon>()
  const wirePolygons = new WeakMap<
    NativeDrcWire,
    WeakMap<NativeDrcWire, Polygon>
  >()
  const getGeometry = (polygon: Polygon): CopperGeometry => {
    let geometry = geometryCache.get(polygon)
    if (!geometry) {
      geometry = {
        box: polygon.box,
        facePoints: [...polygon.faces].map((face) => face.first.start),
        edges: [...polygon.edges].map((edge) => edge.shape),
        edgeIndex: polygon.edges,
      }
      geometryCache.set(polygon, geometry)
    }
    return geometry
  }
  const touches = (a: Polygon, b: Polygon): boolean => {
    if (a.isEmpty() || b.isEmpty()) return false
    const ga = getGeometry(a)
    const gb = getGeometry(b)
    if (
      ga.box.xmin > gb.box.xmax + tolerance ||
      ga.box.xmax < gb.box.xmin - tolerance ||
      ga.box.ymin > gb.box.ymax + tolerance ||
      ga.box.ymax < gb.box.ymin - tolerance
    )
      return false
    if (
      ga.facePoints.some(
        (point) => gb.box.contains(point) && b.contains(point),
      ) ||
      gb.facePoints.some((point) => ga.box.contains(point) && a.contains(point))
    )
      return true
    const [small, large] =
      ga.edges.length <= gb.edges.length ? [ga, gb] : [gb, ga]
    for (const edge of small.edges) {
      const box = edge.box
      const candidates = large.edgeIndex.search(
        new Box(
          box.xmin - tolerance,
          box.ymin - tolerance,
          box.xmax + tolerance,
          box.ymax + tolerance,
        ),
      )
      for (const candidate of candidates)
        if (
          edge.distanceTo((candidate as unknown as Edge).shape)[0] <= tolerance
        )
          return true
    }
    return false
  }
  const getViaPolygon = (via: NativeDrcVia): Polygon => {
    let polygon = viaPolygons.get(via)
    if (!polygon) {
      polygon = new Polygon(
        new Circle(new Point(via.x, via.y), via.diameter / 2),
      )
      if (polygon.orientation() !== ORIENTATION.CCW) polygon.reverse()
      polygon = polygon.scale(scale, scale)
      viaPolygons.set(via, polygon)
    }
    return polygon
  }
  const getWirePolygon = (
    start: NativeDrcWire,
    end: NativeDrcWire,
  ): Polygon => {
    let ends = wirePolygons.get(start)
    if (!ends) {
      ends = new WeakMap()
      wirePolygons.set(start, ends)
    }
    let polygon = ends.get(end)
    if (!polygon) {
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      const radius = start.width / 2
      if (length === 0)
        throw new Error(
          "Zero-length wire entered native physical contact kernel",
        )
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const tangent = Math.acos((radius - radius) / length)
      const first = new Arc(
        new Point(start.x, start.y),
        radius,
        angle + tangent,
        angle - tangent,
        true,
      )
      const second = new Arc(
        new Point(end.x, end.y),
        radius,
        angle - tangent,
        angle + tangent,
        true,
      )
      polygon = new Polygon([
        first,
        new Segment(first.end, second.start),
        second,
        new Segment(second.end, first.start),
      ])
      if (polygon.orientation() !== ORIENTATION.CCW) polygon.reverse()
      polygon = polygon.scale(scale, scale)
      ends.set(end, polygon)
    }
    return polygon
  }
  return {
    viaTouchesSegment: (via, start, end): boolean =>
      touches(getViaPolygon(via), getWirePolygon(start, end)),
    viasTouch: (a, b): boolean => touches(getViaPolygon(a), getViaPolygon(b)),
  }
}
