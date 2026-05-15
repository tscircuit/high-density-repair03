import type { Circle, GraphicsObject, Line, Point, Rect } from "graphics-debug"
import {
  GlobalDrcForceImproveSolver,
  setGlobalDrcForceImproveSolverVisualizer,
} from "../lib/solvers/GlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type {
  GlobalDrcForceImproveSolverParams,
  HighDensityRoute,
  SimpleRouteJson,
} from "../lib"
import type { DrcError } from "../lib/solvers/GlobalDrcForceImproveSolver"
import { mapZToLayerName } from "../lib/utils/mapZToLayerName"

export type VisualizedGlobalDrcForceImproveSolverParams =
  GlobalDrcForceImproveSolverParams & {
    visibleLayer?: "all" | string
  }

export type VisualizedDrcMarker = {
  id: string
  center: { x: number; y: number }
  message: string
  status: "fixed" | "unfixed" | "created"
}

const routeColors = [
  "rgba(37, 99, 235, 0.42)",
  "rgba(220, 38, 38, 0.42)",
  "rgba(5, 150, 105, 0.42)",
  "rgba(124, 58, 237, 0.42)",
  "rgba(217, 119, 6, 0.42)",
  "rgba(8, 145, 178, 0.42)",
]

const getVisibleZ = (
  srj: SimpleRouteJson,
  visibleLayer: "all" | string,
): number | null => {
  if (visibleLayer === "all") return null
  const z = Array.from({ length: srj.layerCount }, (_, index) => index).find(
    (index) => mapZToLayerName(index, srj.layerCount) === visibleLayer,
  )
  return z ?? null
}

const getLayerColor = (z: number) => routeColors[z % routeColors.length]!

const routeSegmentIsVisible = (
  startZ: number,
  endZ: number,
  visibleZ: number | null,
) => visibleZ === null || (startZ === visibleZ && endZ === visibleZ)

const obstacleIsVisible = (
  obstacle: SimpleRouteJson["obstacles"][number],
  visibleLayer: "all" | string,
  visibleZ: number | null,
) => {
  if (visibleZ === null) return true
  if (obstacle.zLayers?.includes(visibleZ)) return true
  if (obstacle.layers.includes(visibleLayer)) return true
  if (visibleZ === 0 && obstacle.layers.includes("top")) return true
  if (visibleZ === 1 && obstacle.layers.includes("bottom")) return true
  return obstacle.layers.length === 0
}

const connectionPointIsVisible = (
  point: SimpleRouteJson["connections"][number]["pointsToConnect"][number],
  visibleLayer: "all" | string,
) => {
  if (visibleLayer === "all") return true
  if ("layer" in point) return point.layer === visibleLayer
  return point.layers.includes(visibleLayer)
}

const connectionPointHasCoordinates = (
  point: SimpleRouteJson["connections"][number]["pointsToConnect"][number],
): point is SimpleRouteJson["connections"][number]["pointsToConnect"][number] & {
  x: number
  y: number
} =>
  typeof (point as { x?: unknown }).x === "number" &&
  Number.isFinite((point as { x: number }).x) &&
  typeof (point as { y?: unknown }).y === "number" &&
  Number.isFinite((point as { y: number }).y)

const getRouteLines = (
  routes: HighDensityRoute[],
  visibleZ: number | null,
): Line[] =>
  routes.flatMap((route, routeIndex) => {
    const lines: Line[] = []
    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end) continue
      if (start.z !== end.z) continue
      if (!routeSegmentIsVisible(start.z, end.z, visibleZ)) continue
      lines.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: getLayerColor(start.z),
        strokeWidth: Math.max(route.traceThickness, 0.04),
        label: `${route.connectionName} z${start.z}`,
        zIndex: -100 + routeIndex,
      })
    }
    return lines
  })

const getViaCircles = (
  routes: HighDensityRoute[],
  visibleZ: number | null,
): Circle[] =>
  routes.flatMap((route) => {
    const diameter = route.viaDiameter || 0.3
    const explicitVias = route.vias.map((via) => ({
      center: { x: via.x, y: via.y },
      radius: diameter / 2,
      fill: "rgba(17, 24, 39, 0.5)",
      stroke: "rgba(248, 250, 252, 0.5)",
      label: `${route.connectionName} via`,
    }))

    if (explicitVias.length > 0 || visibleZ !== null) return explicitVias

    const derivedVias: Circle[] = []
    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end || start.z === end.z) continue
      derivedVias.push({
        center: { x: start.x, y: start.y },
        radius: diameter / 2,
        fill: "rgba(17, 24, 39, 0.5)",
        stroke: "rgba(248, 250, 252, 0.5)",
        label: `${route.connectionName} via`,
      })
    }
    return derivedVias
  })

const getObstacleRects = (
  srj: SimpleRouteJson,
  visibleLayer: "all" | string,
  visibleZ: number | null,
): Rect[] =>
  srj.obstacles
    .filter((obstacle) => obstacleIsVisible(obstacle, visibleLayer, visibleZ))
    .map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      ccwRotationDegrees: obstacle.ccwRotationDegrees,
      fill: obstacle.isCopperPour
        ? "rgba(20, 184, 166, 0.34)"
        : "rgba(148, 163, 184, 0.58)",
      stroke: obstacle.isCopperPour ? "#0f766e" : "#64748b",
      label: obstacle.obstacleId,
    }))

const getConnectionPoints = (
  srj: SimpleRouteJson,
  visibleLayer: "all" | string,
): Point[] =>
  srj.connections.flatMap((connection) =>
    connection.pointsToConnect
      .filter((point) => connectionPointIsVisible(point, visibleLayer))
      .filter(connectionPointHasCoordinates)
      .map((point) => ({
        x: point.x,
        y: point.y,
        color: "#111827",
        label: connection.name,
      })),
  )

const getBoardRect = (srj: SimpleRouteJson): Rect => ({
  center: {
    x: (srj.bounds.minX + srj.bounds.maxX) / 2,
    y: (srj.bounds.minY + srj.bounds.maxY) / 2,
  },
  width: srj.bounds.maxX - srj.bounds.minX,
  height: srj.bounds.maxY - srj.bounds.minY,
  fill: "rgba(255, 255, 255, 0)",
  stroke: "#0f172a",
  label: "board bounds",
})

const DRC_MARKER_MATCH_TOLERANCE = 0.08

const getDrcErrorCenter = (
  error: DrcError,
): { x: number; y: number } | null => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return null
  const maybeCenter = center as Record<string, unknown>
  return typeof maybeCenter.x === "number" && typeof maybeCenter.y === "number"
    ? { x: maybeCenter.x, y: maybeCenter.y }
    : null
}

const getDrcErrorMessage = (error: DrcError) =>
  typeof error.message === "string" ? error.message : "DRC error"

const getDrcErrorKey = (error: DrcError, center: { x: number; y: number }) => {
  const stableId =
    typeof error.pcb_error_id === "string"
      ? error.pcb_error_id
      : typeof error.pcb_trace_id === "string"
        ? error.pcb_trace_id
        : getDrcErrorMessage(error)
  return `${stableId}:${center.x.toFixed(2)}:${center.y.toFixed(2)}`
}

const centersAreClose = (
  left: { x: number; y: number },
  right: { x: number; y: number },
) =>
  Math.hypot(left.x - right.x, left.y - right.y) <= DRC_MARKER_MATCH_TOLERANCE

const isDrcCenter = (
  center: { x: number; y: number } | null,
): center is { x: number; y: number } => center !== null

export const getDrcMarkersForSolver = (
  solver: GlobalDrcForceImproveSolver,
): VisualizedDrcMarker[] => {
  const initialErrors = getDrcSnapshot(
    solver.srj,
    solver.inputHdRoutes,
    solver.drcEvaluator,
  ).errors
  const currentErrors = getDrcSnapshot(
    solver.srj,
    solver.outputHdRoutes,
    solver.drcEvaluator,
  ).errors
  const currentCenters = currentErrors
    .map(getDrcErrorCenter)
    .filter(isDrcCenter)
  const initialCenters = initialErrors
    .map(getDrcErrorCenter)
    .filter(isDrcCenter)
  const seenKeys = new Set<string>()

  const initialMarkers = initialErrors.flatMap(
    (error): VisualizedDrcMarker[] => {
      const center = getDrcErrorCenter(error)
      if (!center) return []

      const key = getDrcErrorKey(error, center)
      if (seenKeys.has(key)) return []
      seenKeys.add(key)

      const isStillPresent = currentCenters.some((currentCenter) =>
        centersAreClose(center, currentCenter),
      )

      return [
        {
          id: key,
          center,
          message: getDrcErrorMessage(error),
          status: isStillPresent ? "unfixed" : "fixed",
        },
      ]
    },
  )

  const createdMarkers = currentErrors.flatMap(
    (error): VisualizedDrcMarker[] => {
      const center = getDrcErrorCenter(error)
      if (!center) return []
      const matchesInitial = initialCenters.some((initialCenter) =>
        centersAreClose(center, initialCenter),
      )
      if (matchesInitial) return []

      const key = `created:${getDrcErrorKey(error, center)}`
      if (seenKeys.has(key)) return []
      seenKeys.add(key)

      return [
        {
          id: key,
          center,
          message: getDrcErrorMessage(error),
          status: "created",
        },
      ]
    },
  )

  return [...initialMarkers, ...createdMarkers]
}

const getDrcMarkerCircles = (
  solver: GlobalDrcForceImproveSolver,
  selectedDrcMarkerId?: string,
): Circle[] =>
  getDrcMarkersForSolver(solver).map((marker) => {
    const isSelected = marker.id === selectedDrcMarkerId
    const isFixed = marker.status === "fixed"
    return {
      center: marker.center,
      radius: isSelected ? 0.32 : 0.22,
      fill: isFixed ? "rgba(34, 197, 94, 0.42)" : "rgba(147, 51, 234, 0.38)",
      stroke: isSelected ? "#111827" : isFixed ? "#16a34a" : "#7e22ce",
      label: `${marker.status}: ${marker.message}`,
    }
  })

const getDrcMarkerById = (
  solver: GlobalDrcForceImproveSolver,
  markerId: string | undefined,
) =>
  markerId
    ? getDrcMarkersForSolver(solver).find((marker) => marker.id === markerId)
    : undefined

export const visualizeGlobalDrcForceImproveSolver = (
  solver: GlobalDrcForceImproveSolver,
  visibleLayer: "all" | string,
  selectedDrcMarkerId?: string,
): GraphicsObject => {
  const visibleZ = getVisibleZ(solver.srj, visibleLayer)
  const routes = solver.outputHdRoutes

  const graphics: GraphicsObject = {
    title: `Global DRC Force Improve (${visibleLayer})`,
    coordinateSystem: "cartesian",
    rects: [
      getBoardRect(solver.srj),
      ...getObstacleRects(solver.srj, visibleLayer, visibleZ),
    ],
    lines: getRouteLines(routes, visibleZ),
    circles: [
      ...getViaCircles(routes, visibleZ),
      ...getDrcMarkerCircles(solver, selectedDrcMarkerId),
    ],
    points: getConnectionPoints(solver.srj, visibleLayer),
  }

  getDrcMarkerById(solver, selectedDrcMarkerId)
  return graphics
}

setGlobalDrcForceImproveSolverVisualizer((solver) =>
  visualizeGlobalDrcForceImproveSolver(solver, "all"),
)

export class VisualizedGlobalDrcForceImproveSolver extends GlobalDrcForceImproveSolver {
  private readonly visibleLayer: "all" | string
  private selectedDrcMarkerId: string | undefined

  constructor(params: VisualizedGlobalDrcForceImproveSolverParams) {
    const { visibleLayer = "all", ...solverParams } = params
    super(solverParams)
    this.visibleLayer = visibleLayer
  }

  setSelectedDrcMarkerId(markerId: string | undefined) {
    this.selectedDrcMarkerId = markerId
  }

  override getSolverName() {
    return "GlobalDrcForceImproveSolver"
  }

  override visualize(): GraphicsObject {
    return visualizeGlobalDrcForceImproveSolver(
      this,
      this.visibleLayer,
      this.selectedDrcMarkerId,
    )
  }
}
