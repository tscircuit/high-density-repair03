import {
  distSq,
  doBoundsOverlap,
  pointToBoundsDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  boundaryIntersections,
  boundaryProjections,
  createCircle,
  createLine,
} from "./findPadClearanceViaPosition"
import type { Point, Segment, ViaNode } from "./internalTypes"
import { sharesNet } from "./netUtils"
import { MAX_ERROR_MOVE, POSITION_EPSILON } from "./solverConfig"

/**
 * Finds local via placements on the clearance capsules of neighboring traces.
 * The caller checks pads, attached traces, and complete-board DRC.
 */
export const findTraceClearanceViaPositions = (
  via: ViaNode,
  segments: readonly Segment[],
  clearance: number,
  connMap?: ConnectivityMap,
): Point[] => {
  const minZ = Math.min(...via.zLayers)
  const maxZ = Math.max(...via.zLayers)
  const constraints = segments
    .filter(
      (segment) =>
        segment.z >= minZ &&
        segment.z <= maxZ &&
        !sharesNet(via.rootConnectionName, segment.rootConnectionName, connMap),
    )
    .map((segment) => ({
      segment,
      required: via.radius + segment.radius + clearance,
    }))
    .filter(
      ({ segment, required }) =>
        pointToSegmentDistance(via, segment.start, segment.end) <=
        required + MAX_ERROR_MOVE,
    )
  const boundaries = constraints
    .flatMap(({ segment, required }) => {
      const { start, end } = segment
      const length = Math.sqrt(distSq(start, end))
      if (length <= POSITION_EPSILON) return []
      const radius = required + POSITION_EPSILON
      const dx = ((end.y - start.y) / length) * radius
      const dy = ((start.x - end.x) / length) * radius
      return [
        createLine(
          { x: start.x + dx, y: start.y + dy },
          { x: end.x + dx, y: end.y + dy },
        ),
        createLine(
          { x: start.x - dx, y: start.y - dy },
          { x: end.x - dx, y: end.y - dy },
        ),
        createCircle(start, radius),
        createCircle(end, radius),
      ]
    })
    .filter(
      (boundary) =>
        pointToBoundsDistance(via, boundary.bounds) <= MAX_ERROR_MOVE,
    )
  const candidates: Point[] = []
  const consider = (point: Point) => {
    if (
      distSq(point, via) > MAX_ERROR_MOVE ** 2 ||
      candidates.some(
        (candidate) => distSq(candidate, point) < POSITION_EPSILON ** 2,
      ) ||
      constraints.some(
        ({ segment, required }) =>
          pointToSegmentDistance(point, segment.start, segment.end) < required,
      )
    ) {
      return
    }
    candidates.push(point)
  }
  consider(via)
  for (let left = 0; left < boundaries.length; left += 1) {
    const a = boundaries[left]!
    for (const point of boundaryProjections(via, a)) consider(point)
    for (let right = left + 1; right < boundaries.length; right += 1) {
      const b = boundaries[right]!
      if (!doBoundsOverlap(a.bounds, b.bounds)) continue
      for (const point of boundaryIntersections(a, b)) consider(point)
    }
  }
  return candidates.sort((a, b) => distSq(a, via) - distSq(b, via))
}
