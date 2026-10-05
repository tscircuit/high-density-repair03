// Frozen geometry kernels from high-density-repair03 5ec4410 and main 4987f52.
// These original blocks are identical on both bases.
import type { SimpleRouteJson } from "../../lib/types"
import type {
  Point,
  Segment,
} from "../../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import { POSITION_EPSILON } from "../../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
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

const pointToSegmentProjection = (point: Point, segment: Segment) =>
  projectPointOntoLineSegment(point, segment.start, segment.end)

export const getRectRepulsion = (
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

type SegmentContact = {
  leftT: number
  rightT: number
  leftPoint: Point
  rightPoint: Point
}

export const getClosestSegmentContact = (
  left: Segment,
  right: Segment,
): SegmentContact => {
  const leftStartProjection = pointToSegmentProjection(left.start, right)
  const leftEndProjection = pointToSegmentProjection(left.end, right)
  const rightStartProjection = pointToSegmentProjection(right.start, left)
  const rightEndProjection = pointToSegmentProjection(right.end, left)

  const candidates: SegmentContact[] = [
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
  ]
  let closest = candidates[0]!
  let closestDistance = Math.hypot(
    closest.leftPoint.x - closest.rightPoint.x,
    closest.leftPoint.y - closest.rightPoint.y,
  )
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    const distance = Math.hypot(
      candidate.leftPoint.x - candidate.rightPoint.x,
      candidate.leftPoint.y - candidate.rightPoint.y,
    )
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }
  return closest
}

export const getSegmentRectRepulsion = (
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
