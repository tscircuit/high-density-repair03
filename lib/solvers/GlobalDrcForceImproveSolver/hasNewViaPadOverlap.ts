import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import { getRootConnectionName, obstacleSharesNet } from "./netUtils"
import { getViaEdgeToPadEdgeClearance } from "./solverConfig"

type Via = { x: number; y: number; minZ: number; maxZ: number }

const getVias = (route: HighDensityRoute): Via[] => {
  const vias: Via[] = []
  for (let i = 1; i < route.route.length; i++) {
    const start = route.route[i - 1]!
    const end = route.route[i]!
    if (start.z === end.z || start.toNextSegmentType === "through_obstacle") {
      continue
    }
    if (start.x !== end.x || start.y !== end.y) {
      throw new Error("Layer-move via endpoints must coincide")
    }
    vias.push({
      x: end.x,
      y: end.y,
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
    })
  }
  return vias
}

/**
 * Safe layer moves create outside-pad vias. Explicit via-in-pad moves use
 * their separate, opt-in operation.
 */
export const hasNewViaPadOverlap = (
  srj: SimpleRouteJson,
  previousRoute: HighDensityRoute,
  candidateRoute: HighDensityRoute,
  connMap?: ConnectivityMap,
): boolean => {
  const previousVias = getVias(previousRoute)
  const radius = candidateRoute.viaDiameter / 2
  for (const via of getVias(candidateRoute)) {
    const existing = previousVias.filter(
      (old) =>
        old.x === via.x &&
        old.y === via.y &&
        previousRoute.viaDiameter >= candidateRoute.viaDiameter,
    )
    if (existing.some((old) => old.minZ <= via.minZ && old.maxZ >= via.maxZ)) {
      continue
    }
    for (const obstacle of srj.obstacles) {
      if (obstacle.isCopperPour) continue
      const maximumMargin =
        radius + Math.max(0, getViaEdgeToPadEdgeClearance(srj))
      const dx = via.x - obstacle.center.x
      const dy = via.y - obstacle.center.y
      if (
        Math.hypot(dx, dy) >
        Math.hypot(obstacle.width, obstacle.height) / 2 + maximumMargin
      ) {
        continue
      }
      let addsCopperOnPadLayer = false
      for (let z = via.minZ; z <= via.maxZ; z++) {
        if (existing.some((old) => z >= old.minZ && z <= old.maxZ)) continue
        if (
          obstacle.zLayers && obstacle.zLayers.length > 0
            ? obstacle.zLayers.includes(z)
            : obstacle.layers.includes(mapZToLayerName(z, srj.layerCount))
        ) {
          addsCopperOnPadLayer = true
          break
        }
      }
      if (!addsCopperOnPadLayer) continue
      const sameNet =
        obstacleSharesNet(
          getRootConnectionName(candidateRoute),
          obstacle,
          connMap,
        ) ||
        obstacleSharesNet(candidateRoute.connectionName, obstacle, connMap)
      const margin =
        radius +
        (sameNet
          ? (srj.minViaEdgeToPadEdgeClearance ?? 0)
          : getViaEdgeToPadEdgeClearance(srj))
      const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const x = Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle))
      const y = Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle))
      const halfWidth = obstacle.width / 2
      const halfHeight = obstacle.height / 2
      const circular =
        obstacle.ccwRotationDegrees === undefined &&
        obstacle.layers.length > 1 &&
        Math.abs(obstacle.width - obstacle.height) < 0.001
      const roundRadius = circular
        ? Math.max(halfWidth, halfHeight)
        : obstacle.type === "oval"
          ? Math.min(halfWidth, halfHeight)
          : 0
      const outsideX = Math.max(0, x - Math.max(0, halfWidth - roundRadius))
      const outsideY = Math.max(0, y - Math.max(0, halfHeight - roundRadius))
      const distance = Math.hypot(outsideX, outsideY) - roundRadius
      if (distance < margin) return true
    }
  }
  return false
}
