import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import {
  applyTracePairLayerMoveForError,
  cloneRoutesForIndexes,
  materializeRoutesForIndexes,
} from "./solverHelpers"

type Point = HighDensityRoute["route"][number]
type Contact = { indexes: [number, number]; positions: [number, number] }
type LocatedPoint = { index: number; point: Point }
type Params = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  pair: readonly [string, string]
  connMap?: ConnectivityMap
  viaHoleDiameter?: number
}

const projectParameter = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const squaredLength = dx * dx + dy * dy
  if (squaredLength === 0) return 0
  return Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength,
    ),
  )
}

const interpolate = (start: Point, end: Point, t: number): Point => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
  z: start.z,
})

const closestParameters = (
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): [number, number] => {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const ex = d.x - c.x,
    ey = d.y - c.y
  const determinant = dx * ey - dy * ex
  if (Math.abs(determinant) > 1e-12) {
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant
    const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [t, u]
  }
  const candidates: [number, number][] = [
    [0, projectParameter(a, c, d)],
    [1, projectParameter(b, c, d)],
    [projectParameter(c, a, b), 0],
    [projectParameter(d, a, b), 1],
  ]
  let best = candidates[0]!,
    bestDistance = Infinity
  for (const candidate of candidates) {
    const left = interpolate(a, b, candidate[0])
    const right = interpolate(c, d, candidate[1])
    const distance = Math.hypot(left.x - right.x, left.y - right.y)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

const collectPairContacts = (
  left: HighDensityRoute,
  right: HighDensityRoute,
): Contact[] => {
  const contacts: Contact[] = []
  for (let i = 1; i < left.route.length; i++) {
    const a = left.route[i - 1]!,
      b = left.route[i]!
    if (a.z !== b.z || a.toNextSegmentType === "through_obstacle") continue
    for (let j = 1; j < right.route.length; j++) {
      const c = right.route[j - 1]!,
        d = right.route[j]!
      if (
        c.z !== d.z ||
        a.z !== c.z ||
        c.toNextSegmentType === "through_obstacle"
      )
        continue
      if (
        segmentToSegmentMinDistance(a, b, c, d) >=
        (left.traceThickness + right.traceThickness) / 2 - 1e-9
      )
        continue
      const [t, u] = closestParameters(a, b, c, d)
      contacts.push({ indexes: [i, j], positions: [i - 1 + t, j - 1 + u] })
    }
  }
  return contacts
}

const locateAlongRoute = (
  route: HighDensityRoute,
  position: number,
  direction: -1 | 1,
  distance: number,
): LocatedPoint | undefined => {
  const lower = Math.min(Math.floor(position), route.route.length - 2)
  let point = interpolate(
    route.route[lower]!,
    route.route[lower + 1]!,
    position - lower,
  )
  let index = direction < 0 ? lower : lower + 1
  while (index >= 0 && index < route.route.length) {
    const next = route.route[index]!
    const segmentStart = direction < 0 ? next : route.route[index - 1]!
    if (
      point.z !== next.z ||
      segmentStart.toNextSegmentType === "through_obstacle"
    )
      return undefined
    const length = Math.hypot(next.x - point.x, next.y - point.y)
    if (length >= distance && length > 0) {
      if (Math.abs(length - distance) <= 1e-9 && next.pcb_port_id)
        return undefined
      return {
        index: direction < 0 ? index : index - 1,
        point: interpolate(point, next, distance / length),
      }
    }
    distance -= length
    point = next
    index += direction
  }
  return undefined
}

/** Local displacements and layer bridges; every proposal needs whole-board validation. */
export function* getPeerTraceRepairCandidates({
  srj,
  routes,
  pair,
  connMap,
  viaHoleDiameter,
}: Params): Generator<HighDensityRoute[]> {
  const leftIndexes = routes.flatMap((route, index) =>
    route.connectionName === pair[0] ? [index] : [],
  )
  const rightIndexes = routes.flatMap((route, index) =>
    route.connectionName === pair[1] ? [index] : [],
  )
  for (const leftIndex of leftIndexes)
    for (const rightIndex of rightIndexes) {
      const indexes = [leftIndex, rightIndex] as const
      const left = routes[leftIndex]!,
        right = routes[rightIndex]!
      const contacts = collectPairContacts(left, right)
      if (contacts.length === 0) continue
      for (const side of [0, 1] as const) {
        const routeIndex = indexes[side],
          route = routes[routeIndex]!
        const stationary = routes[indexes[1 - side]!]!
        for (const sign of [-1, 1])
          for (const margin of [0.001, 0.1])
            for (const expansion of [0, 1]) {
              const candidate = cloneRoutesForIndexes(routes, [routeIndex])
              for (const contact of contacts) {
                const pointIndex = contact.indexes[side],
                  otherIndex = contact.indexes[1 - side]!
                const a = stationary.route[otherIndex - 1]!,
                  b = stationary.route[otherIndex]!
                const dx = b.x - a.x,
                  dy = b.y - a.y,
                  length = Math.hypot(dx, dy)
                if (length <= 1e-9) continue
                const nx = (-dy / length) * sign,
                  ny = (dx / length) * sign
                const separation =
                  (left.traceThickness + right.traceThickness) / 2 + margin
                for (
                  let i = Math.max(1, pointIndex - 1 - expansion);
                  i <= Math.min(route.route.length - 2, pointIndex + expansion);
                  i++
                ) {
                  const point = candidate[routeIndex]!.route[i]!
                  const previous = route.route[i - 1]!,
                    next = route.route[i + 1]!
                  if (
                    point.z !== a.z ||
                    point.pcb_port_id ||
                    previous.z !== point.z ||
                    next.z !== point.z ||
                    previous.toNextSegmentType === "through_obstacle" ||
                    point.toNextSegmentType === "through_obstacle"
                  )
                    continue
                  const depth =
                    separation - ((point.x - a.x) * nx + (point.y - a.y) * ny)
                  if (depth > 0) {
                    point.x += depth * nx
                    point.y += depth * ny
                  }
                }
              }
              if (
                candidate[routeIndex]!.route.every(
                  (point) =>
                    point.x >= srj.bounds.minX &&
                    point.x <= srj.bounds.maxX &&
                    point.y >= srj.bounds.minY &&
                    point.y <= srj.bounds.maxY,
                )
              ) {
                yield materializeRoutesForIndexes(candidate, [routeIndex])
              }
            }
        // Bridge the actual contact before trying the wider vertex span.
        // A short crossing can be bypassed without moving neighboring copper.
        const spans = [
          [
            Math.min(...contacts.map((contact) => contact.positions[side])),
            Math.max(...contacts.map((contact) => contact.positions[side])),
          ],
          [
            Math.min(...contacts.map((contact) => contact.indexes[side])) - 1,
            Math.max(...contacts.map((contact) => contact.indexes[side])),
          ],
        ] as const
        for (const [startPosition, endPosition] of spans) {
          const z = route.route[Math.floor(startPosition)]!.z
          const distances = [0.15, 0.3, 0.6, 1, 2]
          for (const before of distances)
            for (const after of distances)
              for (let targetZ = 0; targetZ < srj.layerCount; targetZ++) {
                if (targetZ === z) continue
                const start = locateAlongRoute(route, startPosition, -1, before)
                const end = locateAlongRoute(route, endPosition, 1, after)
                if (!start || !end || start.index > end.index) continue
                const middle = route.route.slice(start.index + 1, end.index + 1)
                if (
                  middle.some(
                    (point) =>
                      point.z !== z ||
                      point.pcb_port_id ||
                      point.toNextSegmentType === "through_obstacle",
                  )
                )
                  continue
                const candidate = cloneRoutesForIndexes(routes, [routeIndex])
                candidate[routeIndex]!.route = [
                  ...route.route.slice(0, start.index + 1),
                  start.point,
                  { ...start.point, z: targetZ },
                  ...middle.map((point) => ({ ...point, z: targetZ })),
                  { ...end.point, z: targetZ },
                  end.point,
                  ...route.route.slice(end.index + 1),
                ]
                yield materializeRoutesForIndexes(candidate, [routeIndex])
              }
        }
      }
      const indexById = new Map([
        ["peer_left", leftIndex],
        ["peer_right", rightIndex],
      ])
      for (const contact of contacts) {
        const center = interpolate(
          left.route[contact.indexes[0] - 1]!,
          left.route[contact.indexes[0]]!,
          contact.positions[0] - contact.indexes[0] + 1,
        )
        const error = {
          type: "pcb_trace_error",
          pcb_trace_id: "peer_left",
          pcb_trace_ids: ["peer_left", "peer_right"],
          center,
          minimum_clearance: 0.1,
        }
        for (const side of [0, 1] as const)
          for (let targetZ = 0; targetZ < srj.layerCount; targetZ++)
            for (const expansion of [0, 1, 2, 4]) {
              const candidate = cloneRoutesForIndexes(routes, [indexes[side]])
              if (
                applyTracePairLayerMoveForError(
                  srj,
                  candidate,
                  error,
                  indexById,
                  side,
                  targetZ,
                  expansion,
                  connMap,
                  viaHoleDiameter,
                )
              ) {
                yield materializeRoutesForIndexes(candidate, [indexes[side]])
              }
            }
      }
    }
}
