import {
  distance,
  getUnitVectorFromPointAToB,
  midpoint,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  segmentToBoxMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { getRootConnectionName, obstacleSharesNet, sharesNet } from "./netUtils"
import { cloneRoutes } from "./solverHelpers"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"

const CLEARANCE_EPSILON = 1e-6
const RELAXATION_CLEARANCE_SLACK = 0.006
const RELAXATION_ITERATIONS = 160
const RELAXATION_PASSES = 4
const MAX_NUDGE_DISTANCE = 0.5
const CANDIDATE_SCALES = [1, 0.5, 0.25, 0.1, 0.05, 0.025] as const

type Point2D = { x: number; y: number }
type Point3D = Point2D & { z: number }

type ClearanceBlocker =
  | {
      kind: "pad"
      obstacle: SimpleRouteJson["obstacles"][number]
      zLayers: number[]
    }
  | {
      kind: "via"
      center: Point2D
      diameter: number
      zLayers: number[]
      connectionName: string
      rootConnectionName?: string
    }

const getTraceHalfWidth = (srj: SimpleRouteJson, route: HighDensityRoute) =>
  (route.traceThickness ?? srj.minTraceWidth) / 2

const getRouteViaDiameter = (srj: SimpleRouteJson, route: HighDensityRoute) =>
  route.viaDiameter ?? srj.minViaDiameter ?? 0.3

const pointsEqual = (left: Point2D, right: Point2D) =>
  distance(left, right) < CLEARANCE_EPSILON

const normalizeVector = (vector: Point2D): Point2D => {
  const magnitude = distance({ x: 0, y: 0 }, vector)
  if (magnitude < CLEARANCE_EPSILON) return { x: 0, y: 0 }
  return getUnitVectorFromPointAToB({ x: 0, y: 0 }, vector)
}

const limitVector = (vector: Point2D, maxMagnitude: number): Point2D => {
  const magnitude = distance({ x: 0, y: 0 }, vector)
  if (magnitude <= maxMagnitude || magnitude < CLEARANCE_EPSILON) return vector
  const scale = maxMagnitude / magnitude
  return { x: vector.x * scale, y: vector.y * scale }
}

const getObstacleZLayers = (
  obstacle: SimpleRouteJson["obstacles"][number],
  layerCount: number,
) => {
  if (obstacle.zLayers && obstacle.zLayers.length > 0) {
    return obstacle.zLayers
  }

  const zLayers = Array.from({ length: layerCount }, (_, z) => z).filter((z) =>
    obstacle.layers.includes(mapZToLayerName(z, layerCount)),
  )

  return zLayers.length > 0
    ? zLayers
    : Array.from({ length: layerCount }, (_, z) => z)
}

const blockerAppliesToLayer = (blocker: ClearanceBlocker, z: number) =>
  blocker.zLayers.includes(z)

const routesAreConnected = (left: HighDensityRoute, right: HighDensityRoute) =>
  sharesNet(getRootConnectionName(left), getRootConnectionName(right)) ||
  sharesNet(getRootConnectionName(left), right.connectionName) ||
  sharesNet(left.connectionName, getRootConnectionName(right)) ||
  sharesNet(left.connectionName, right.connectionName)

const isSameNetObstacle = (
  route: HighDensityRoute,
  obstacle: SimpleRouteJson["obstacles"][number],
) =>
  obstacleSharesNet(getRootConnectionName(route), obstacle) ||
  obstacleSharesNet(route.connectionName, obstacle)

const getClearanceBlockersForRoute = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  route: HighDensityRoute,
) => {
  const blockers: ClearanceBlocker[] = []

  for (const obstacle of srj.obstacles) {
    if (obstacle.isCopperPour || isSameNetObstacle(route, obstacle)) continue
    blockers.push({
      kind: "pad",
      obstacle,
      zLayers: getObstacleZLayers(obstacle, srj.layerCount),
    })
  }

  const allZLayers = Array.from({ length: srj.layerCount }, (_, z) => z)
  for (const otherRoute of routes) {
    if (otherRoute === route || routesAreConnected(route, otherRoute)) continue

    for (const via of otherRoute.vias) {
      blockers.push({
        kind: "via",
        center: { x: via.x, y: via.y },
        diameter: getRouteViaDiameter(srj, otherRoute),
        zLayers: allZLayers,
        connectionName: otherRoute.connectionName,
        rootConnectionName: otherRoute.rootConnectionName,
      })
    }
  }

  return blockers
}

const getSignedClearanceToBlocker = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  start: Point3D,
  end: Point3D,
  blocker: ClearanceBlocker,
) => {
  if (!blockerAppliesToLayer(blocker, start.z)) return Number.POSITIVE_INFINITY

  const traceHalfWidth = getTraceHalfWidth(srj, route)
  if (blocker.kind === "pad") {
    return (
      segmentToBoxMinDistance(start, end, blocker.obstacle) -
      (srj.minTraceToPadEdgeClearance! +
        traceHalfWidth +
        RELAXATION_CLEARANCE_SLACK)
    )
  }

  return (
    pointToSegmentDistance(blocker.center, start, end) -
    (srj.minTraceToPadEdgeClearance! +
      traceHalfWidth +
      blocker.diameter / 2 +
      RELAXATION_CLEARANCE_SLACK)
  )
}

const getPushDirectionForBlocker = (
  start: Point3D,
  end: Point3D,
  blocker: ClearanceBlocker,
) => {
  const blockerCenter =
    blocker.kind === "pad" ? blocker.obstacle.center : blocker.center
  const closestPoint = pointToSegmentClosestPoint(blockerCenter, start, end)
  let direction = normalizeVector({
    x: closestPoint.x - blockerCenter.x,
    y: closestPoint.y - blockerCenter.y,
  })

  if (
    Math.abs(direction.x) < CLEARANCE_EPSILON &&
    Math.abs(direction.y) < CLEARANCE_EPSILON
  ) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const segmentMidpoint = midpoint(start, end)
    const normalA = normalizeVector({ x: -dy, y: dx })
    const normalB = { x: -normalA.x, y: -normalA.y }
    direction =
      distance(
        { x: segmentMidpoint.x + normalA.x, y: segmentMidpoint.y + normalA.y },
        blockerCenter,
      ) >=
      distance(
        { x: segmentMidpoint.x + normalB.x, y: segmentMidpoint.y + normalB.y },
        blockerCenter,
      )
        ? normalA
        : normalB
  }

  return direction
}

const isFixedRoutePoint = (route: HighDensityRoute, pointIndex: number) => {
  if (pointIndex <= 0 || pointIndex >= route.route.length - 1) return true

  const point = route.route[pointIndex]
  if (!point || point.insideJumperPad) return true

  const previous = route.route[pointIndex - 1]
  const next = route.route[pointIndex + 1]
  if (previous && previous.z !== point.z) return true
  if (next && next.z !== point.z) return true

  return route.vias.some((via) => pointsEqual(via, point))
}

const getRouteClearancePenalty = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  blockers: ClearanceBlocker[],
) => {
  let penalty = 0

  for (let i = 0; i < route.route.length - 1; i += 1) {
    const start = route.route[i]
    const end = route.route[i + 1]
    if (!start || !end || start.z !== end.z || pointsEqual(start, end)) continue

    for (const blocker of blockers) {
      const signedClearance = getSignedClearanceToBlocker(
        srj,
        route,
        start,
        end,
        blocker,
      )
      if (signedClearance >= 0) continue

      penalty += signedClearance * signedClearance

      if (blocker.kind === "pad") {
        const distanceToPad = segmentToBoxMinDistance(
          start,
          end,
          blocker.obstacle,
        )
        if (distanceToPad < CLEARANCE_EPSILON) {
          const centerDistance = pointToSegmentDistance(
            blocker.obstacle.center,
            start,
            end,
          )
          penalty += 0.01 / (centerDistance + 0.01)
        }
      }
    }
  }

  return penalty
}

const getRouteOtherTraceClearancePenalty = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  otherRoutes: HighDensityRoute[],
) => {
  let penalty = 0

  for (let i = 0; i < route.route.length - 1; i += 1) {
    const start = route.route[i]
    const end = route.route[i + 1]
    if (!start || !end || start.z !== end.z || pointsEqual(start, end)) continue

    for (const otherRoute of otherRoutes) {
      if (routesAreConnected(route, otherRoute)) continue

      for (let j = 0; j < otherRoute.route.length - 1; j += 1) {
        const otherStart = otherRoute.route[j]
        const otherEnd = otherRoute.route[j + 1]
        if (
          !otherStart ||
          !otherEnd ||
          otherStart.z !== start.z ||
          otherEnd.z !== start.z ||
          pointsEqual(otherStart, otherEnd)
        ) {
          continue
        }

        const clearance =
          segmentToSegmentMinDistance(start, end, otherStart, otherEnd) -
          getTraceHalfWidth(srj, route) -
          getTraceHalfWidth(srj, otherRoute)
        const violation =
          srj.minTraceToPadEdgeClearance! +
          RELAXATION_CLEARANCE_SLACK -
          clearance
        if (violation > 0) penalty += violation * violation
      }

      for (const via of otherRoute.vias) {
        const clearance =
          pointToSegmentDistance(via, start, end) -
          getTraceHalfWidth(srj, route) -
          getRouteViaDiameter(srj, otherRoute) / 2
        const violation =
          srj.minTraceToPadEdgeClearance! +
          RELAXATION_CLEARANCE_SLACK -
          clearance
        if (violation > 0) penalty += violation * violation
      }
    }
  }

  return penalty
}

const computeNudgeForces = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  blockers: ClearanceBlocker[],
  otherRoutes: HighDensityRoute[],
) => {
  const forces = route.route.map(() => ({ x: 0, y: 0 }))

  for (let i = 0; i < route.route.length - 1; i += 1) {
    const start = route.route[i]
    const end = route.route[i + 1]
    if (!start || !end || start.z !== end.z || pointsEqual(start, end)) continue

    for (const blocker of blockers) {
      const signedClearance = getSignedClearanceToBlocker(
        srj,
        route,
        start,
        end,
        blocker,
      )
      if (signedClearance >= 0) continue

      const direction = getPushDirectionForBlocker(start, end, blocker)
      if (
        Math.abs(direction.x) < CLEARANCE_EPSILON &&
        Math.abs(direction.y) < CLEARANCE_EPSILON
      ) {
        continue
      }

      const startMovable = !isFixedRoutePoint(route, i)
      const endMovable = !isFixedRoutePoint(route, i + 1)
      if (!startMovable && !endMovable) continue

      const violation = -signedClearance
      const startWeight =
        startMovable && endMovable ? 0.5 : startMovable ? 1 : 0
      const endWeight = startMovable && endMovable ? 0.5 : endMovable ? 1 : 0

      forces[i]!.x += direction.x * violation * startWeight
      forces[i]!.y += direction.y * violation * startWeight
      forces[i + 1]!.x += direction.x * violation * endWeight
      forces[i + 1]!.y += direction.y * violation * endWeight
    }

    for (const otherRoute of otherRoutes) {
      if (routesAreConnected(route, otherRoute)) continue

      for (let j = 0; j < otherRoute.route.length - 1; j += 1) {
        const otherStart = otherRoute.route[j]
        const otherEnd = otherRoute.route[j + 1]
        if (
          !otherStart ||
          !otherEnd ||
          otherStart.z !== start.z ||
          otherEnd.z !== start.z ||
          pointsEqual(otherStart, otherEnd)
        ) {
          continue
        }

        const clearance =
          segmentToSegmentMinDistance(start, end, otherStart, otherEnd) -
          getTraceHalfWidth(srj, route) -
          getTraceHalfWidth(srj, otherRoute)
        const violation =
          srj.minTraceToPadEdgeClearance! +
          RELAXATION_CLEARANCE_SLACK -
          clearance
        if (violation <= 0) continue

        const segmentMidpoint = midpoint(start, end)
        const closestPoint = pointToSegmentClosestPoint(
          segmentMidpoint,
          otherStart,
          otherEnd,
        )
        let direction = normalizeVector({
          x: segmentMidpoint.x - closestPoint.x,
          y: segmentMidpoint.y - closestPoint.y,
        })
        if (
          Math.abs(direction.x) < CLEARANCE_EPSILON &&
          Math.abs(direction.y) < CLEARANCE_EPSILON
        ) {
          const dx = end.x - start.x
          const dy = end.y - start.y
          direction = normalizeVector({ x: -dy, y: dx })
        }

        const startMovable = !isFixedRoutePoint(route, i)
        const endMovable = !isFixedRoutePoint(route, i + 1)
        if (!startMovable && !endMovable) continue

        const startWeight =
          startMovable && endMovable ? 0.5 : startMovable ? 1 : 0
        const endWeight = startMovable && endMovable ? 0.5 : endMovable ? 1 : 0

        forces[i]!.x += direction.x * violation * startWeight
        forces[i]!.y += direction.y * violation * startWeight
        forces[i + 1]!.x += direction.x * violation * endWeight
        forces[i + 1]!.y += direction.y * violation * endWeight
      }
    }
  }

  return forces
}

const applyNudgeForces = (
  route: HighDensityRoute,
  forces: Point2D[],
  scale: number,
): HighDensityRoute => ({
  ...route,
  route: route.route.map((point, pointIndex) => {
    if (isFixedRoutePoint(route, pointIndex)) return { ...point }
    const force = limitVector(
      forces[pointIndex] ?? { x: 0, y: 0 },
      MAX_NUDGE_DISTANCE,
    )
    return {
      ...point,
      x: point.x + force.x * scale,
      y: point.y + force.y * scale,
    }
  }),
  vias: route.vias.map((via) => ({ ...via })),
  jumpers: route.jumpers ? [...route.jumpers] : undefined,
})

const routeStaysInsideBounds = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
) =>
  route.route.every(
    (point) =>
      point.x >= srj.bounds.minX - CLEARANCE_EPSILON &&
      point.x <= srj.bounds.maxX + CLEARANCE_EPSILON &&
      point.y >= srj.bounds.minY - CLEARANCE_EPSILON &&
      point.y <= srj.bounds.maxY + CLEARANCE_EPSILON,
  )

const nudgeRoute = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  route: HighDensityRoute,
  routeIndex: number,
) => {
  const blockers = getClearanceBlockersForRoute(srj, routes, route)
  const otherRoutes = routes.filter(
    (otherRoute, otherRouteIndex) =>
      otherRouteIndex !== routeIndex && otherRoute !== route,
  )
  let nudgedRoute = route
  let currentPenalty =
    getRouteClearancePenalty(srj, nudgedRoute, blockers) +
    getRouteOtherTraceClearancePenalty(srj, nudgedRoute, otherRoutes)

  for (let iteration = 0; iteration < RELAXATION_ITERATIONS; iteration += 1) {
    if (currentPenalty <= CLEARANCE_EPSILON) break

    const forces = computeNudgeForces(srj, nudgedRoute, blockers, otherRoutes)
    if (forces.every((force) => distance(force, { x: 0, y: 0 }) < 1e-9)) {
      break
    }

    let acceptedCandidate: HighDensityRoute | null = null
    let acceptedPenalty = currentPenalty

    for (const scale of CANDIDATE_SCALES) {
      const candidate = applyNudgeForces(nudgedRoute, forces, scale)
      const candidatePenalty =
        getRouteClearancePenalty(srj, candidate, blockers) +
        getRouteOtherTraceClearancePenalty(srj, candidate, otherRoutes)

      if (
        candidatePenalty < currentPenalty - 1e-6 &&
        routeStaysInsideBounds(srj, candidate)
      ) {
        acceptedCandidate = candidate
        acceptedPenalty = candidatePenalty
        break
      }
    }

    if (!acceptedCandidate) break
    nudgedRoute = acceptedCandidate
    currentPenalty = acceptedPenalty
  }

  return nudgedRoute
}

export const applyTraceToPadClearanceRelaxation = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
) => {
  if (
    srj.minTraceToPadEdgeClearance === undefined ||
    srj.minTraceToPadEdgeClearance <= 0
  ) {
    return routes
  }

  let changed = false
  const relaxedRoutes = cloneRoutes(routes)

  for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
    for (
      let routeIndex = 0;
      routeIndex < relaxedRoutes.length;
      routeIndex += 1
    ) {
      const route = relaxedRoutes[routeIndex]
      if (!route) continue
      const nudgedRoute = nudgeRoute(srj, relaxedRoutes, route, routeIndex)
      if (nudgedRoute !== route) {
        relaxedRoutes[routeIndex] = nudgedRoute
        changed = true
      }
    }
  }

  return changed ? relaxedRoutes : routes
}
