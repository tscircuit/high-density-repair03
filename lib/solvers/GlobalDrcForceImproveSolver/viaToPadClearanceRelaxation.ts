import { distance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { obstacleSharesNet } from "./netUtils"
import {
  cloneRoutes,
  collectViaNodes,
  getObstacleZLayers,
  getPointToObstacleDistance,
  getRectRepulsion,
  materializeRoutes,
} from "./solverHelpers"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ViaNode } from "./internalTypes"
import { COORDINATE_EPSILON } from "./solverConfig"

const CLEARANCE_EPSILON = 1e-6
const RELAXATION_CLEARANCE_SLACK = 0.006
const RELAXATION_ITERATIONS = 160
const RELAXATION_PASSES = 4
const MAX_NUDGE_DISTANCE = 0.5
const CANDIDATE_SCALES = [1, 0.5, 0.25, 0.1, 0.05, 0.025] as const

type Point2D = { x: number; y: number }

// Route-point indexes remain stable while relaxation moves their coordinates.
// Null identifies a new via, rather than an attachment from the original route.
type ViaOrigins = Array<Map<number, ViaNode | null>>

type ViaPadBlocker = {
  obstacle: SimpleRouteJson["obstacles"][number]
  clearance: number
  isSameNet: boolean
}

const limitVector = (vector: Point2D, maxMagnitude: number): Point2D => {
  const magnitude = distance({ x: 0, y: 0 }, vector)
  if (magnitude <= maxMagnitude || magnitude < CLEARANCE_EPSILON) return vector
  const scale = maxMagnitude / magnitude
  return { x: vector.x * scale, y: vector.y * scale }
}

const zLayersOverlap = (left: number[], right: number[]) =>
  left.some((z) => right.includes(z))

const getViaOrigins = (
  routes: HighDensityRoute[],
  existingRoutes: HighDensityRoute[],
  defaultViaDiameter = 0.3,
): ViaOrigins => {
  const origins: ViaOrigins = routes.map(() => new Map())
  const existingVias = collectViaNodes(existingRoutes, defaultViaDiameter)
  for (const via of collectViaNodes(routes, defaultViaDiameter)) {
    const existingVia = existingVias.find(
      (existing) =>
        existing.routeIndex === via.routeIndex &&
        Math.abs(existing.x - via.x) <= COORDINATE_EPSILON &&
        Math.abs(existing.y - via.y) <= COORDINATE_EPSILON,
    )
    for (const pointIndex of via.pointIndexes) {
      origins[via.routeIndex]!.set(pointIndex, existingVia ?? null)
    }
  }
  return origins
}

const viaIsAttachedToSameNetObstacle = (
  via: ViaNode,
  route: HighDensityRoute,
  viaOrigins: ViaOrigins,
  obstacle: SimpleRouteJson["obstacles"][number],
  connMap?: ConnectivityMap,
) => {
  const isSameNet =
    obstacleSharesNet(via.rootConnectionName, obstacle, connMap) ||
    obstacleSharesNet(route.connectionName, obstacle, connMap)

  return (
    isSameNet &&
    via.pointIndexes.every((pointIndex) => {
      const originalVia = viaOrigins[via.routeIndex]?.get(pointIndex)
      return (
        originalVia !== undefined &&
        originalVia !== null &&
        getPointToObstacleDistance(originalVia, obstacle) <= CLEARANCE_EPSILON
      )
    })
  )
}

const getMinimumOwnPadDistance = (
  via: ViaNode,
  viaOrigins: ViaOrigins,
  obstacle: SimpleRouteJson["obstacles"][number],
) =>
  Math.max(
    ...via.pointIndexes.map((pointIndex) => {
      const originalVia = viaOrigins[via.routeIndex]?.get(pointIndex)
      // A new via must clear the pad with its whole copper radius. Existing
      // overlaps may improve incrementally, but must never become worse.
      return originalVia
        ? via.radius +
            Math.min(
              0,
              getPointToObstacleDistance(originalVia, obstacle) -
                originalVia.radius,
            )
        : via.radius
    }),
  )

const getViaPadBlockers = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  viaOrigins: ViaOrigins,
  via: ViaNode,
  connMap?: ConnectivityMap,
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
) => {
  const blockers: ViaPadBlocker[] = []
  const route = routes[via.routeIndex]
  if (!route) return blockers

  for (const obstacle of srj.obstacles) {
    if (
      obstacle.isCopperPour ||
      // Only an attachment present before relaxation is exempt. Moving an
      // external via into its own pad must not make the pad stop repelling it.
      viaIsAttachedToSameNetObstacle(via, route, viaOrigins, obstacle, connMap)
    ) {
      continue
    }

    const zLayers = getObstacleZLayers(obstacle, srj.layerCount)
    if (!zLayersOverlap(via.zLayers, zLayers)) continue
    const isSameNet =
      obstacleSharesNet(via.rootConnectionName, obstacle, connMap) ||
      obstacleSharesNet(route.connectionName, obstacle, connMap)
    // Candidate placement only requires an external via to clear its own pad;
    // applying foreign-net spacing can push it into neighboring copper. The
    // optional post-solve spacing pass retains its configured same-net margin.
    blockers.push({
      obstacle,
      isSameNet,
      clearance: isSameNet
        ? sameNetClearance
        : srj.minViaEdgeToPadEdgeClearance!,
    })
  }

  return blockers
}

const getSignedClearanceToBlocker = (via: ViaNode, blocker: ViaPadBlocker) =>
  getPointToObstacleDistance(via, blocker.obstacle) -
  (via.radius + blocker.clearance + RELAXATION_CLEARANCE_SLACK)

const getViaClearancePenalty = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  viaOrigins: ViaOrigins,
  via: ViaNode,
  connMap?: ConnectivityMap,
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
) => {
  let penalty = 0
  for (const blocker of getViaPadBlockers(
    srj,
    routes,
    viaOrigins,
    via,
    connMap,
    sameNetClearance,
  )) {
    const signedClearance = getSignedClearanceToBlocker(via, blocker)
    if (signedClearance >= 0) continue

    penalty += signedClearance * signedClearance

    if (getPointToObstacleDistance(via, blocker.obstacle) < CLEARANCE_EPSILON) {
      const centerDistance = distance(via, blocker.obstacle.center)
      penalty += 0.01 / (centerDistance + 0.01)
    }
  }

  return penalty
}

const getRouteViaClearancePenalty = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  viaOrigins: ViaOrigins,
  routeIndex: number,
  connMap?: ConnectivityMap,
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
) =>
  collectViaNodes(routes, srj.minViaDiameter)
    .filter((via) => via.routeIndex === routeIndex)
    .reduce(
      (penalty, via) =>
        penalty +
        getViaClearancePenalty(
          srj,
          routes,
          viaOrigins,
          via,
          connMap,
          sameNetClearance,
        ),
      0,
    )

const computeViaNudgeForces = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  viaOrigins: ViaOrigins,
  routeIndex: number,
  connMap?: ConnectivityMap,
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
) => {
  const route = routes[routeIndex]
  if (!route) return []
  const forces = route.route.map(() => ({ x: 0, y: 0 }))
  const vias = collectViaNodes(routes, srj.minViaDiameter).filter(
    (via) => via.routeIndex === routeIndex,
  )

  for (const via of vias) {
    if (!via.movable) continue

    for (const blocker of getViaPadBlockers(
      srj,
      routes,
      viaOrigins,
      via,
      connMap,
      sameNetClearance,
    )) {
      const requiredDistance =
        via.radius + blocker.clearance + RELAXATION_CLEARANCE_SLACK
      const repulsion = getRectRepulsion(
        via,
        blocker.obstacle,
        requiredDistance,
      )
      if (!repulsion) continue

      for (const pointIndex of via.pointIndexes) {
        forces[pointIndex]!.x += repulsion.direction.x * repulsion.penetration
        forces[pointIndex]!.y += repulsion.direction.y * repulsion.penetration
      }
    }
  }

  return forces
}

const applyNudgeForces = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  forces: Point2D[],
  scale: number,
): HighDensityRoute => {
  const viaPointIndexes = new Set(
    collectViaNodes([route], srj.minViaDiameter).flatMap((via) =>
      via.movable ? via.pointIndexes : [],
    ),
  )

  return {
    ...route,
    route: route.route.map((point, pointIndex) => {
      if (!viaPointIndexes.has(pointIndex)) return { ...point }
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
  }
}

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

const nudgeRouteVias = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  viaOrigins: ViaOrigins,
  route: HighDensityRoute,
  routeIndex: number,
  connMap?: ConnectivityMap,
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
) => {
  let nudgedRoute = route
  let currentPenalty = getRouteViaClearancePenalty(
    srj,
    routes,
    viaOrigins,
    routeIndex,
    connMap,
    sameNetClearance,
  )

  for (let iteration = 0; iteration < RELAXATION_ITERATIONS; iteration += 1) {
    if (currentPenalty <= CLEARANCE_EPSILON) break

    const forces = computeViaNudgeForces(
      srj,
      routes,
      viaOrigins,
      routeIndex,
      connMap,
      sameNetClearance,
    )
    if (forces.every((force) => distance(force, { x: 0, y: 0 }) < 1e-9)) {
      break
    }

    let acceptedCandidate: HighDensityRoute | null = null
    let acceptedPenalty = currentPenalty

    for (const scale of CANDIDATE_SCALES) {
      const candidate = applyNudgeForces(srj, nudgedRoute, forces, scale)
      const candidateRoutes = [...routes]
      candidateRoutes[routeIndex] = candidate
      const candidatePenalty = getRouteViaClearancePenalty(
        srj,
        candidateRoutes,
        viaOrigins,
        routeIndex,
        connMap,
        sameNetClearance,
      )

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
    routes[routeIndex] = acceptedCandidate
    nudgedRoute = acceptedCandidate
    currentPenalty = acceptedPenalty
  }

  return nudgedRoute
}

export const applyViaToPadClearanceRelaxation = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  connMap?: ConnectivityMap,
  // Post-solve spacing keeps its configured same-net preference. Layer-change
  // candidates use zero: remain outside connected pads without imposing
  // foreign-net electrical clearance on their own terminals.
  sameNetClearance = srj.minViaEdgeToPadEdgeClearance!,
  // Routes before a speculative topology edit, aligned by route index.
  // Spacing-only callers omit this because their input vias already exist.
  existingRoutes: HighDensityRoute[] = routes,
) => {
  if (
    srj.minViaEdgeToPadEdgeClearance === undefined ||
    srj.minViaEdgeToPadEdgeClearance <= 0
  ) {
    return routes
  }

  const changedRouteIndexes = new Set<number>()
  const viaOrigins = getViaOrigins(routes, existingRoutes, srj.minViaDiameter)
  const relaxedRoutes = cloneRoutes(routes)

  for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
    for (
      let routeIndex = 0;
      routeIndex < relaxedRoutes.length;
      routeIndex += 1
    ) {
      const route = relaxedRoutes[routeIndex]
      if (!route) continue
      const nudgedRoute = nudgeRouteVias(
        srj,
        relaxedRoutes,
        viaOrigins,
        route,
        routeIndex,
        connMap,
        sameNetClearance,
      )
      if (nudgedRoute !== route) {
        relaxedRoutes[routeIndex] = nudgedRoute
        changedRouteIndexes.add(routeIndex)
      }
    }
  }

  if (changedRouteIndexes.size === 0) return routes
  const completedRoutes = materializeRoutes(relaxedRoutes)
  for (const via of collectViaNodes(completedRoutes, srj.minViaDiameter)) {
    if (!changedRouteIndexes.has(via.routeIndex)) continue
    const overlapsOwnPad = getViaPadBlockers(
      srj,
      completedRoutes,
      viaOrigins,
      via,
      connMap,
      sameNetClearance,
    ).some(
      (blocker) =>
        blocker.isSameNet &&
        getPointToObstacleDistance(via, blocker.obstacle) <
          getMinimumOwnPadDistance(via, viaOrigins, blocker.obstacle),
    )
    if (!overlapsOwnPad) continue
    // Force iterations may explore partial placements, but committing one
    // must not introduce or worsen own-pad copper overlap. A failed placement
    // leaves the original candidate for its caller's full-board DRC gate.
    completedRoutes[via.routeIndex] = routes[via.routeIndex]!
    changedRouteIndexes.delete(via.routeIndex)
  }
  return changedRouteIndexes.size > 0 ? completedRoutes : routes
}
