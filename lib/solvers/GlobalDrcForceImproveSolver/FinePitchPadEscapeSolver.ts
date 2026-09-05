import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import type { DrcError, DrcEvaluator } from "./types"
import { cloneRoutes } from "./solverHelpers"

type Obstacle = SimpleRouteJson["obstacles"][number]
type Point = { x: number; y: number }
type PadEscapeBoard = Pick<
  SimpleRouteJson,
  | "bounds"
  | "layerCount"
  | "obstacles"
  | "minTraceToPadEdgeClearance"
  | "minViaEdgeToPadEdgeClearance"
>

export type FinePitchPadEscapeResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
  remainingErrors: DrcError[]
}

export type FinePitchPadEscapeSolverParams = {
  srj: PadEscapeBoard
  routes: HighDensityRoute[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  drcEvaluator: DrcEvaluator
}

const evaluateErrors = (
  drcEvaluator: DrcEvaluator,
  routes: HighDensityRoute[],
): DrcError[] => {
  const result = drcEvaluator({ hdRoutes: routes, routes, traces: [] })
  return Array.isArray(result)
    ? result
    : (result.errorsWithCenters ?? result.errors)
}

const issueScore = (errors: DrcError[]): number =>
  errors.reduce((score, error) => {
    if (
      typeof error.actual_clearance === "number" &&
      typeof error.minimum_clearance === "number"
    ) {
      return (
        score + Math.max(0, error.minimum_clearance - error.actual_clearance)
      )
    }
    const message = typeof error.message === "string" ? error.message : ""
    const gap = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
    return score + (gap ? Math.max(0, 0.1 - Number.parseFloat(gap[1]!)) : 1)
  }, 0)

const isBetter = (candidate: DrcError[], current: DrcError[]): boolean =>
  candidate.length < current.length ||
  (candidate.length === current.length &&
    issueScore(candidate) < issueScore(current) - 1e-9)

const DETOUR_DISTANCE_CANDIDATES = [0.025, 0.05, 0.075, 0.1, 0.15, 0.2]
const DETOUR_POINT_WINDOW_RADII = [1, 2, 3, Number.POSITIVE_INFINITY]
const DETOUR_ANGLE_OFFSETS = [
  0,
  Math.PI / 8,
  -Math.PI / 8,
  Math.PI / 4,
  -Math.PI / 4,
  (3 * Math.PI) / 8,
  (-3 * Math.PI) / 8,
  Math.PI / 2,
  -Math.PI / 2,
]
const MAX_LOCAL_PAD_DETOUR_PASSES = 8

const isObstacleTraceError = (error: DrcError) => {
  if (error.type === "pcb_pad_trace_clearance_error") return true
  if (error.type !== "pcb_trace_error") return false
  return !(
    Array.isArray(error.pcb_trace_ids) && error.pcb_trace_ids.length >= 2
  )
}

const getErrorObstacle = (
  srj: PadEscapeBoard,
  error: DrcError,
): Obstacle | undefined => {
  return srj.obstacles.find((obstacle) => {
    const obstacleId = obstacle.obstacleId ?? obstacle.connectedTo[0]
    if (!obstacleId) return false
    return (
      error.pcb_pad_id === obstacleId ||
      error.pcb_obstacle_id === obstacleId ||
      (typeof error.pcb_trace_id === "string" &&
        error.pcb_trace_error_id ===
          `overlap_${error.pcb_trace_id}_${obstacleId}`)
    )
  })
}

const usesFinePitchPadClearance = (srj: PadEscapeBoard): boolean => {
  const traceClearance = srj.minTraceToPadEdgeClearance
  const viaClearance = srj.minViaEdgeToPadEdgeClearance
  return (
    typeof traceClearance === "number" &&
    typeof viaClearance === "number" &&
    Math.min(traceClearance, viaClearance) < 0.1 - 1e-9
  )
}

const createLocalPadDetourCandidate = ({
  routes,
  routeIndex,
  conflictingObstacle,
  pointWindowRadius,
  bounds,
  layerCount,
  traceClearance,
  transformPoint,
}: {
  routes: HighDensityRoute[]
  routeIndex: number
  conflictingObstacle: Obstacle
  pointWindowRadius: number
  bounds: SimpleRouteJson["bounds"]
  layerCount: number
  traceClearance: number
  transformPoint: (point: Point) => Point
}): HighDensityRoute[] | undefined => {
  const route = routes[routeIndex]
  if (!route || route.route.length < 3) return undefined
  const viaLocations = new Set(
    route.vias.map((via) => `${via.x.toFixed(9)}:${via.y.toFixed(9)}`),
  )
  const influenceRadius =
    Math.hypot(conflictingObstacle.width, conflictingObstacle.height) / 2 +
    route.traceThickness / 2 +
    traceClearance +
    0.5
  const movablePointIndexes = route.route
    .map((point, pointIndex) => ({ point, pointIndex }))
    .filter(
      ({ point, pointIndex }) =>
        pointIndex > 0 &&
        pointIndex < route.route.length - 1 &&
        point.pcb_port_id === undefined &&
        !point.insideJumperPad &&
        point.toNextSegmentType !== "through_obstacle" &&
        route.route[pointIndex - 1]!.toNextSegmentType !== "through_obstacle" &&
        point.z === route.route[pointIndex - 1]!.z &&
        point.z === route.route[pointIndex + 1]!.z &&
        conflictingObstacle.layers.includes(
          mapZToLayerName(point.z, layerCount),
        ) &&
        !viaLocations.has(`${point.x.toFixed(9)}:${point.y.toFixed(9)}`) &&
        Math.hypot(
          point.x - conflictingObstacle.center.x,
          point.y - conflictingObstacle.center.y,
        ) <= influenceRadius,
    )
    .map(({ pointIndex }) => pointIndex)
  if (movablePointIndexes.length === 0) return undefined
  const nearestMovablePointIndex = movablePointIndexes.reduce(
    (nearestPointIndex, pointIndex) => {
      const nearestPoint = route.route[nearestPointIndex]!
      const point = route.route[pointIndex]!
      return Math.hypot(
        point.x - conflictingObstacle.center.x,
        point.y - conflictingObstacle.center.y,
      ) <
        Math.hypot(
          nearestPoint.x - conflictingObstacle.center.x,
          nearestPoint.y - conflictingObstacle.center.y,
        )
        ? pointIndex
        : nearestPointIndex
    },
  )
  const detourPointIndexes = movablePointIndexes.filter(
    (pointIndex) =>
      Math.abs(pointIndex - nearestMovablePointIndex) <= pointWindowRadius,
  )

  const candidateRoutes = cloneRoutes(routes)
  const candidateRoute = candidateRoutes[routeIndex]!
  for (const pointIndex of detourPointIndexes) {
    const point = candidateRoute.route[pointIndex]!
    const shiftedPoint = transformPoint(point)
    const radius = route.traceThickness / 2
    if (
      shiftedPoint.x - radius < bounds.minX ||
      shiftedPoint.x + radius > bounds.maxX ||
      shiftedPoint.y - radius < bounds.minY ||
      shiftedPoint.y + radius > bounds.maxY
    ) {
      return undefined
    }
    Object.assign(point, shiftedPoint)
  }
  return candidateRoutes
}

const getFinePitchChannelAlignment = ({
  srj,
  route,
  conflictingObstacle,
  nearestPoint,
}: {
  srj: PadEscapeBoard
  route: HighDensityRoute
  conflictingObstacle: Obstacle
  nearestPoint: Point & { z: number }
}): { axis: "x" | "y"; coordinate: number } | undefined => {
  const layer = mapZToLayerName(nearestPoint.z, srj.layerCount)
  const deltaFromObstacle = {
    x: nearestPoint.x - conflictingObstacle.center.x,
    y: nearestPoint.y - conflictingObstacle.center.y,
  }
  const axis =
    Math.abs(deltaFromObstacle.x) >= Math.abs(deltaFromObstacle.y) ? "x" : "y"
  const perpendicularAxis = axis === "x" ? "y" : "x"
  const dimension = axis === "x" ? "width" : "height"
  const direction = Math.sign(deltaFromObstacle[axis]) || 1
  const neighbors = srj.obstacles
    .filter(
      (obstacle) =>
        obstacle !== conflictingObstacle &&
        obstacle.layers.includes(layer) &&
        (conflictingObstacle.componentId === undefined ||
          obstacle.componentId === conflictingObstacle.componentId) &&
        Math.abs(
          obstacle.center[perpendicularAxis] -
            conflictingObstacle.center[perpendicularAxis],
        ) < 1e-3 &&
        Math.sign(obstacle.center[axis] - conflictingObstacle.center[axis]) ===
          direction,
    )
    .sort(
      (left, right) =>
        Math.abs(left.center[axis] - conflictingObstacle.center[axis]) -
        Math.abs(right.center[axis] - conflictingObstacle.center[axis]),
    )
  const neighbor = neighbors[0]
  if (!neighbor) return undefined

  const conflictingEdge =
    conflictingObstacle.center[axis] +
    direction * (conflictingObstacle[dimension] / 2)
  const neighborEdge =
    neighbor.center[axis] - direction * (neighbor[dimension] / 2)
  const openChannelWidth = direction * (neighborEdge - conflictingEdge)
  const requiredChannelWidth =
    route.traceThickness + 2 * (srj.minTraceToPadEdgeClearance ?? 0.1)
  if (openChannelWidth < requiredChannelWidth - 1e-6) return undefined
  return {
    axis,
    coordinate: (conflictingEdge + neighborEdge) / 2,
  }
}

/**
 * Repair short interior bends near fine-pitch pads using a bounded channel and
 * radial search. Only routes in routeIndexByTraceId are movable; the caller's
 * evaluator must include all fixed copper when scoring each candidate.
 * Endpoints, port points, and via sites remain fixed.
 */
export class FinePitchPadEscapeSolver extends BaseSolver {
  private readonly search: Generator<
    FinePitchPadEscapeResult,
    FinePitchPadEscapeResult
  >
  private currentResult: FinePitchPadEscapeResult

  constructor(readonly params: FinePitchPadEscapeSolverParams) {
    super()
    this.currentResult = {
      routes: params.routes,
      attemptedCandidateCount: 0,
      acceptedCandidateCount: 0,
      remainingErrors: [],
    }
    // Creating the iterator does no search or DRC work. Only _step advances it.
    this.search = this.searchCandidates()
  }

  override getConstructorParams(): [FinePitchPadEscapeSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const next = this.search.next()
    this.currentResult = next.value
    this.stats = {
      attemptedCandidateCount: next.value.attemptedCandidateCount,
      acceptedCandidateCount: next.value.acceptedCandidateCount,
      remainingDrcIssueCount: next.value.remainingErrors.length,
    }
    this.progress = Math.min(0.99, this.iterations / this.MAX_ITERATIONS)
    if (next.done) {
      this.solved = true
      this.progress = 1
    }
  }

  override getOutput(): FinePitchPadEscapeResult {
    if (!this.solved) {
      throw new Error(
        "FinePitchPadEscapeSolver: output requested before solved",
      )
    }
    return this.currentResult
  }

  override visualize(): GraphicsObject {
    return {
      title: "Fine-pitch pad escape repair",
      coordinateSystem: "cartesian",
      rects: this.params.srj.obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255, 0, 0, 0.2)",
        label: obstacle.obstacleId ?? obstacle.connectedTo[0],
      })),
      lines: this.currentResult.routes.flatMap((route) =>
        route.route.slice(1).flatMap((point, index) => {
          const previous = route.route[index]!
          if (point.z !== previous.z) return []
          return [
            {
              points: [previous, point],
              strokeWidth: route.traceThickness,
              strokeColor: point.z === 0 ? "red" : "rgba(0, 0, 255, 0.4)",
              strokeDash: point.z === 0 ? undefined : [0.12, 0.08],
              layer: `z${point.z}`,
              label: route.connectionName,
            },
          ]
        }),
      ),
      circles: this.currentResult.routes.flatMap((route) =>
        route.vias.map((via) => ({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "blue",
        })),
      ),
    }
  }

  private *searchCandidates(): Generator<
    FinePitchPadEscapeResult,
    FinePitchPadEscapeResult
  > {
    const { srj, routes, routeIndexByTraceId, drcEvaluator } = this.params
    let currentRoutes = routes
    let currentErrors = evaluateErrors(drcEvaluator, routes)
    let attemptedCandidateCount = 0
    let acceptedCandidateCount = 0
    const getResult = (): FinePitchPadEscapeResult => ({
      routes: currentRoutes,
      attemptedCandidateCount,
      acceptedCandidateCount,
      remainingErrors: currentErrors,
    })
    const candidatesPerError =
      DETOUR_POINT_WINDOW_RADII.length *
      (1 + DETOUR_DISTANCE_CANDIDATES.length * DETOUR_ANGLE_OFFSETS.length)
    this.MAX_ITERATIONS =
      3 +
      MAX_LOCAL_PAD_DETOUR_PASSES *
        Math.max(1, currentErrors.length) *
        (candidatesPerError + 1)
    yield getResult()
    // Fine-pitch BGA escapes can contain several short points between the pad
    // terminal and the first open routing channel. Moving only the terminal
    // inside its own pad cannot clear a neighboring pad in that geometry, so
    // shift the nearby non-via points as one connected detour and retain only a
    // whole-board DRC improvement.
    if (usesFinePitchPadClearance(srj)) {
      for (
        let pass = 0;
        pass < MAX_LOCAL_PAD_DETOUR_PASSES && currentErrors.length > 0;
        pass++
      ) {
        let acceptedOnPass = false
        for (const error of currentErrors.filter(isObstacleTraceError)) {
          yield getResult()
          if (typeof error.pcb_trace_id !== "string") continue
          const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id)
          const conflictingObstacle = getErrorObstacle(srj, error)
          if (routeIndex === undefined || !conflictingObstacle) continue
          const route = currentRoutes[routeIndex]!
          const nearestPoint = route.route.reduce<(typeof route.route)[number]>(
            (nearest, point) =>
              Math.hypot(
                point.x - conflictingObstacle.center.x,
                point.y - conflictingObstacle.center.y,
              ) <
              Math.hypot(
                nearest.x - conflictingObstacle.center.x,
                nearest.y - conflictingObstacle.center.y,
              )
                ? point
                : nearest,
            route.route[0]!,
          )
          const outwardAngle = Math.atan2(
            nearestPoint.y - conflictingObstacle.center.y,
            nearestPoint.x - conflictingObstacle.center.x,
          )
          let bestRoutes = currentRoutes
          let bestErrors = currentErrors
          const channelAlignment = getFinePitchChannelAlignment({
            srj,
            route,
            conflictingObstacle,
            nearestPoint,
          })
          if (channelAlignment) {
            for (const pointWindowRadius of DETOUR_POINT_WINDOW_RADII) {
              const candidateRoutes = createLocalPadDetourCandidate({
                routes: currentRoutes,
                routeIndex,
                conflictingObstacle,
                pointWindowRadius,
                bounds: srj.bounds,
                layerCount: srj.layerCount,
                traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
                transformPoint: (point) => ({
                  x:
                    channelAlignment.axis === "x"
                      ? channelAlignment.coordinate
                      : point.x,
                  y:
                    channelAlignment.axis === "y"
                      ? channelAlignment.coordinate
                      : point.y,
                }),
              })
              if (!candidateRoutes) {
                yield getResult()
                continue
              }
              attemptedCandidateCount++
              const candidateErrors = evaluateErrors(
                drcEvaluator,
                candidateRoutes,
              )
              if (isBetter(candidateErrors, bestErrors)) {
                bestRoutes = candidateRoutes
                bestErrors = candidateErrors
              }
              yield getResult()
              if (bestErrors.length === 0) break
            }
          }
          for (const pointWindowRadius of DETOUR_POINT_WINDOW_RADII) {
            if (bestErrors.length === 0) break
            for (const distance of DETOUR_DISTANCE_CANDIDATES) {
              for (const angleOffset of DETOUR_ANGLE_OFFSETS) {
                const angle = outwardAngle + angleOffset
                const candidateRoutes = createLocalPadDetourCandidate({
                  routes: currentRoutes,
                  routeIndex,
                  conflictingObstacle,
                  pointWindowRadius,
                  bounds: srj.bounds,
                  layerCount: srj.layerCount,
                  traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
                  transformPoint: (point) => ({
                    x: point.x + Math.cos(angle) * distance,
                    y: point.y + Math.sin(angle) * distance,
                  }),
                })
                if (!candidateRoutes) {
                  yield getResult()
                  continue
                }
                attemptedCandidateCount++
                const candidateErrors = evaluateErrors(
                  drcEvaluator,
                  candidateRoutes,
                )
                if (isBetter(candidateErrors, bestErrors)) {
                  bestRoutes = candidateRoutes
                  bestErrors = candidateErrors
                }
                yield getResult()
                if (bestErrors.length === 0) break
              }
              if (bestErrors.length === 0) break
            }
            if (bestErrors.length === 0) break
          }
          if (bestRoutes !== currentRoutes) {
            currentRoutes = bestRoutes
            currentErrors = bestErrors
            acceptedCandidateCount++
            acceptedOnPass = true
          }
          if (currentErrors.length === 0) break
        }
        if (!acceptedOnPass) break
      }
    }

    return getResult()
  }
}
