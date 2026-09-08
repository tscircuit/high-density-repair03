import {
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../../types/high-density-types"
import { getRootConnectionName, sharesNet } from "./netUtils"

type Point = { x: number; y: number }
type Copper = { start: Point; end: Point; z: number; radius: number }

const getCopper = (route: HighDensityRoute): Copper[] => {
  const copper: Copper[] = []
  for (let i = 1; i < route.route.length; i++) {
    const start = route.route[i - 1]!
    const end = route.route[i]!
    const traceRadius =
      Math.max(
        start.traceThickness ?? route.traceThickness,
        end.traceThickness ?? route.traceThickness,
      ) / 2
    if (start.z === end.z || start.toNextSegmentType === "through_obstacle") {
      for (
        let z = Math.min(start.z, end.z);
        z <= Math.max(start.z, end.z);
        z++
      ) {
        copper.push({ start, end, z, radius: traceRadius })
      }
    } else {
      if (start.x !== end.x || start.y !== end.y) {
        throw new Error("Layer-move via endpoints must coincide")
      }
      for (
        let z = Math.min(start.z, end.z);
        z <= Math.max(start.z, end.z);
        z++
      ) {
        copper.push({ start: end, end, z, radius: route.viaDiameter / 2 })
      }
    }
  }
  return copper
}

const copperKey = (copper: Copper): string => {
  const a = `${copper.start.x},${copper.start.y}`
  const b = `${copper.end.x},${copper.end.y}`
  const endpoints = a < b ? `${a}:${b}` : `${b}:${a}`
  return `${copper.z}:${copper.radius}:${endpoints}`
}

/** A topology repair may retain incoming copper, but must not add a new short. */
export const hasNewForeignCopperOverlap = (
  previousRoute: HighDensityRoute,
  candidateRoute: HighDensityRoute,
  otherRoutes: readonly HighDensityRoute[],
  connMap?: ConnectivityMap,
): boolean => {
  const previousCopper = getCopper(previousRoute)
  const previousKeys = new Set(previousCopper.map(copperKey))
  const addedCopper = getCopper(candidateRoute).filter(
    (copper) =>
      !previousKeys.has(copperKey(copper)) &&
      !previousCopper.some((previous) => {
        if (previous.z !== copper.z || previous.radius < copper.radius) {
          return false
        }
        // A split or narrowed segment can retain incoming copper without
        // retaining its exact primitive key. Both endpoint discs must fit.
        const margin = previous.radius - copper.radius
        return (
          pointToSegmentDistance(copper.start, previous.start, previous.end) <=
            margin &&
          pointToSegmentDistance(copper.end, previous.start, previous.end) <=
            margin
        )
      }),
  )
  const root = getRootConnectionName(candidateRoute)
  for (const otherRoute of otherRoutes) {
    if (sharesNet(root, getRootConnectionName(otherRoute), connMap)) continue
    for (const foreign of getCopper(otherRoute)) {
      for (const added of addedCopper) {
        if (foreign.z !== added.z) continue
        const radius = foreign.radius + added.radius
        if (
          Math.max(added.start.x, added.end.x) + radius <=
            Math.min(foreign.start.x, foreign.end.x) ||
          Math.max(foreign.start.x, foreign.end.x) + radius <=
            Math.min(added.start.x, added.end.x) ||
          Math.max(added.start.y, added.end.y) + radius <=
            Math.min(foreign.start.y, foreign.end.y) ||
          Math.max(foreign.start.y, foreign.end.y) + radius <=
            Math.min(added.start.y, added.end.y)
        ) {
          continue
        }
        if (
          segmentToSegmentMinDistance(
            added.start,
            added.end,
            foreign.start,
            foreign.end,
          ) < radius
        ) {
          return true
        }
      }
    }
  }
  return false
}
