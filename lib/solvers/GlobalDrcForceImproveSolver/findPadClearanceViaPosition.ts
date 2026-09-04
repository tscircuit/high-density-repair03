import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Point } from "./internalTypes"
import { getRootConnectionName, obstacleSharesNet } from "./netUtils"
import { getViaEdgeToPadEdgeClearance, POSITION_EPSILON } from "./solverConfig"
import { mapZToLayerName } from "../../utils/mapZToLayerName"

type Bounds = SimpleRouteJson["bounds"]
type Line = { kind: "line"; start: Point; end: Point; bounds: Bounds }
type Circle = { kind: "circle"; center: Point; radius: number; bounds: Bounds }
type Boundary = Line | Circle
type PadRegion = {
  center: Point
  halfWidth: number
  halfHeight: number
  cos: number
  sin: number
  circular: boolean
  clearance: number
  bounds: Bounds
}

const squaredDistance = (left: Point, right: Point) =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2

const boundsOverlap = (left: Bounds, right: Bounds) =>
  left.minX <= right.maxX &&
  left.maxX >= right.minX &&
  left.minY <= right.maxY &&
  left.maxY >= right.minY

const pointInsideBounds = (point: Point, bounds: Bounds) =>
  point.x >= bounds.minX &&
  point.x <= bounds.maxX &&
  point.y >= bounds.minY &&
  point.y <= bounds.maxY

const projectToBounds = (point: Point, bounds: Bounds): Point => ({
  x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
  y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
})

const distanceToPad = (point: Point, pad: PadRegion) => {
  const dx = point.x - pad.center.x
  const dy = point.y - pad.center.y
  if (pad.circular) return Math.max(0, Math.hypot(dx, dy) - pad.halfWidth)
  const x = dx * pad.cos + dy * pad.sin
  const y = -dx * pad.sin + dy * pad.cos
  return Math.hypot(
    Math.max(0, Math.abs(x) - pad.halfWidth),
    Math.max(0, Math.abs(y) - pad.halfHeight),
  )
}

const createLine = (start: Point, end: Point): Line => ({
  kind: "line",
  start,
  end,
  bounds: {
    minX: Math.min(start.x, end.x),
    maxX: Math.max(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxY: Math.max(start.y, end.y),
  },
})

const createCircle = (center: Point, radius: number): Circle => ({
  kind: "circle",
  center,
  radius,
  bounds: {
    minX: center.x - radius,
    maxX: center.x + radius,
    minY: center.y - radius,
    maxY: center.y + radius,
  },
})

const getPadBoundaries = (pad: PadRegion): Boundary[] => {
  // Construct slightly outside the exact constraint so roundoff at a tangent
  // cannot turn a geometrically valid new via into a clearance violation.
  const margin = pad.clearance + POSITION_EPSILON
  if (pad.circular) return [createCircle(pad.center, pad.halfWidth + margin)]
  const world = (x: number, y: number): Point => ({
    x: pad.center.x + x * pad.cos - y * pad.sin,
    y: pad.center.y + x * pad.sin + y * pad.cos,
  })
  const { halfWidth: w, halfHeight: h } = pad
  return [
    createLine(world(-w, -h - margin), world(w, -h - margin)),
    createLine(world(w + margin, -h), world(w + margin, h)),
    createLine(world(w, h + margin), world(-w, h + margin)),
    createLine(world(-w - margin, h), world(-w - margin, -h)),
    // Full circles simplify intersections; the global shape test rejects
    // their inward portions, retaining exactly the rounded corner arcs.
    createCircle(world(-w, -h), margin),
    createCircle(world(w, -h), margin),
    createCircle(world(w, h), margin),
    createCircle(world(-w, h), margin),
  ]
}

const boundaryProjections = (point: Point, boundary: Boundary): Point[] => {
  if (boundary.kind === "circle") {
    const dx = point.x - boundary.center.x
    const dy = point.y - boundary.center.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return [
        { x: boundary.center.x + boundary.radius, y: boundary.center.y },
        { x: boundary.center.x - boundary.radius, y: boundary.center.y },
        { x: boundary.center.x, y: boundary.center.y + boundary.radius },
        { x: boundary.center.x, y: boundary.center.y - boundary.radius },
      ]
    }
    return [
      {
        x: boundary.center.x + (dx * boundary.radius) / length,
        y: boundary.center.y + (dy * boundary.radius) / length,
      },
    ]
  }
  const dx = boundary.end.x - boundary.start.x
  const dy = boundary.end.y - boundary.start.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - boundary.start.x) * dx +
              (point.y - boundary.start.y) * dy) /
              lengthSquared,
          ),
        )
  return [
    boundary.start,
    boundary.end,
    {
      x: boundary.start.x + dx * t,
      y: boundary.start.y + dy * t,
    },
  ]
}

const lineCircleIntersections = (line: Line, circle: Circle): Point[] => {
  const dx = line.end.x - line.start.x
  const dy = line.end.y - line.start.y
  const ox = line.start.x - circle.center.x
  const oy = line.start.y - circle.center.y
  const a = dx * dx + dy * dy
  if (a === 0) return []
  const b = 2 * (ox * dx + oy * dy)
  const c = ox * ox + oy * oy - circle.radius * circle.radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => t >= 0 && t <= 1)
    .map((t) => ({ x: line.start.x + dx * t, y: line.start.y + dy * t }))
}

const boundaryIntersections = (left: Boundary, right: Boundary): Point[] => {
  if (left.kind === "line" && right.kind === "circle") {
    return lineCircleIntersections(left, right)
  }
  if (left.kind === "circle" && right.kind === "line") {
    return lineCircleIntersections(right, left)
  }
  if (left.kind === "line" && right.kind === "line") {
    const ax = left.end.x - left.start.x
    const ay = left.end.y - left.start.y
    const bx = right.end.x - right.start.x
    const by = right.end.y - right.start.y
    const denominator = ax * by - ay * bx
    if (denominator === 0) return []
    const dx = right.start.x - left.start.x
    const dy = right.start.y - left.start.y
    const t = (dx * by - dy * bx) / denominator
    const u = (dx * ay - dy * ax) / denominator
    if (t < 0 || t > 1 || u < 0 || u > 1) return []
    return [{ x: left.start.x + ax * t, y: left.start.y + ay * t }]
  }
  if (left.kind !== "circle" || right.kind !== "circle") return []
  const dx = right.center.x - left.center.x
  const dy = right.center.y - left.center.y
  const d = Math.hypot(dx, dy)
  if (
    d === 0 ||
    d > left.radius + right.radius ||
    d < Math.abs(left.radius - right.radius)
  )
    return []
  const along = (left.radius ** 2 - right.radius ** 2 + d ** 2) / (2 * d)
  const perpendicular = Math.sqrt(Math.max(0, left.radius ** 2 - along ** 2))
  const x = left.center.x + (dx * along) / d
  const y = left.center.y + (dy * along) / d
  return [
    { x: x - (dy * perpendicular) / d, y: y + (dx * perpendicular) / d },
    { x: x + (dy * perpendicular) / d, y: y - (dx * perpendicular) / d },
  ]
}

const getPadRegions = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  viaRadius: number,
  zLayers: readonly number[],
  connMap?: ConnectivityMap,
): PadRegion[] => {
  const layers = new Set(zLayers.map((z) => mapZToLayerName(z, srj.layerCount)))
  return srj.obstacles
    .filter(
      (obstacle) =>
        !obstacle.isCopperPour &&
        obstacle.layers.some((layer) => layers.has(layer)),
    )
    .map((obstacle) => {
      const hasRotation =
        typeof obstacle.ccwRotationDegrees === "number" &&
        Number.isFinite(obstacle.ccwRotationDegrees)
      const angle = hasRotation
        ? (obstacle.ccwRotationDegrees! * Math.PI) / 180
        : 0
      const circular =
        !hasRotation &&
        obstacle.layers.length > 1 &&
        Math.abs(obstacle.width - obstacle.height) < 0.001
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const halfWidth = circular
        ? Math.max(obstacle.width, obstacle.height) / 2
        : obstacle.width / 2
      const halfHeight = circular ? halfWidth : obstacle.height / 2
      const sameNet =
        obstacleSharesNet(getRootConnectionName(route), obstacle, connMap) ||
        obstacleSharesNet(route.connectionName, obstacle, connMap)
      const clearance =
        viaRadius + (sameNet ? 0 : getViaEdgeToPadEdgeClearance(srj))
      const extentX =
        Math.abs(cos) * halfWidth +
        Math.abs(sin) * halfHeight +
        clearance +
        POSITION_EPSILON
      const extentY =
        Math.abs(sin) * halfWidth +
        Math.abs(cos) * halfHeight +
        clearance +
        POSITION_EPSILON
      return {
        center: obstacle.center,
        halfWidth,
        halfHeight,
        cos,
        sin,
        circular,
        clearance,
        bounds: {
          minX: obstacle.center.x - extentX,
          maxX: obstacle.center.x + extentX,
          minY: obstacle.center.y - extentY,
          maxY: obstacle.center.y + extentY,
        },
      }
    })
}

/** Checks pad copper on newly occupied layers of a stationary transition. */
export const isViaPositionClearOfPads = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  point: Point,
  viaRadius: number,
  zLayers: readonly number[],
  connMap?: ConnectivityMap,
): boolean =>
  getPadRegions(srj, route, viaRadius, zLayers, connMap).every(
    (pad) => distanceToPad(point, pad) >= pad.clearance,
  )

/**
 * Places a newly constructed via outside pad copper and foreign-net
 * clearance regions. This computes geometry only: the existing route-candidate
 * DRC evaluation still checks its adjacent traces and all other constraints.
 */
export const findPadClearanceViaPosition = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  preferred: Point,
  viaRadius: number,
  zLayers: readonly number[],
  connMap?: ConnectivityMap,
): Point | undefined => {
  const boardMargin = viaRadius + (srj.minBoardEdgeClearance ?? 0)
  const board: Bounds = {
    minX: srj.bounds.minX + boardMargin,
    maxX: srj.bounds.maxX - boardMargin,
    minY: srj.bounds.minY + boardMargin,
    maxY: srj.bounds.maxY - boardMargin,
  }
  if (board.minX > board.maxX || board.minY > board.maxY) return undefined

  const pads = getPadRegions(srj, route, viaRadius, zLayers, connMap)
  const isFeasible = (point: Point) =>
    pointInsideBounds(point, board) &&
    pads.every((pad) => distanceToPad(point, pad) >= pad.clearance)
  const projected = projectToBounds(preferred, board)
  if (isFeasible(projected))
    return pointInsideBounds(preferred, board) ? preferred : projected

  // Only the connected local obstruction can displace this point. Bounding
  // boxes conservatively connect rounded regions without enumerating the
  // boundaries of unrelated pads elsewhere on the board.
  const component = pads.filter(
    (pad) => distanceToPad(projected, pad) < pad.clearance,
  )
  const included = new Set(component)
  for (let index = 0; index < component.length; index += 1) {
    for (const pad of pads) {
      if (
        !included.has(pad) &&
        boundsOverlap(component[index]!.bounds, pad.bounds)
      ) {
        included.add(pad)
        component.push(pad)
      }
    }
  }
  const boundaries = component.flatMap(getPadBoundaries)
  const bottomLeft = { x: board.minX, y: board.minY }
  const bottomRight = { x: board.maxX, y: board.minY }
  const topRight = { x: board.maxX, y: board.maxY }
  const topLeft = { x: board.minX, y: board.maxY }
  boundaries.push(
    createLine(bottomLeft, bottomRight),
    createLine(bottomRight, topRight),
    createLine(topRight, topLeft),
    createLine(topLeft, bottomLeft),
  )

  let best: Point | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  const consider = (candidate: Point) => {
    const candidateDistance = squaredDistance(candidate, preferred)
    if (candidateDistance < bestDistance && isFeasible(candidate)) {
      best = candidate
      bestDistance = candidateDistance
    }
  }
  for (const boundary of boundaries) {
    for (const point of boundaryProjections(preferred, boundary))
      consider(point)
  }
  for (let left = 0; left < boundaries.length; left += 1) {
    const a = boundaries[left]!
    if (
      squaredDistance(preferred, projectToBounds(preferred, a.bounds)) >
      bestDistance
    )
      continue
    for (let right = left + 1; right < boundaries.length; right += 1) {
      const b = boundaries[right]!
      if (!boundsOverlap(a.bounds, b.bounds)) continue
      if (
        squaredDistance(preferred, projectToBounds(preferred, b.bounds)) >
        bestDistance
      )
        continue
      for (const point of boundaryIntersections(a, b)) consider(point)
    }
  }
  return best
}
