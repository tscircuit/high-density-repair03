import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import {
  cloneRoutesForIndexes,
  materializeRoutesForIndexes,
} from "./solverHelpers"

type Board = Pick<
  SimpleRouteJson,
  "bounds" | "layerCount" | "obstacles" | "minBoardEdgeClearance"
>
type RoutePoint = HighDensityRoute["route"][number] & {
  traceThickness?: number
}

const OFFSET_FACTORS = [0, 0.75, -0.75, 1, -1, 1.5, -1.5, 2, -2]

/**
 * Shorten a BGA escape by relocating its existing terminal-side via outside
 * the pad. When the adjoining interior span is bounded by another via, also
 * try other layers. No via is added and no endpoint or intermediate port moves.
 * This is a lazy geometry generator: the owning solver scores one yield/step.
 */
export function* getTerminalViaEscapeCandidates({
  srj,
  routes,
  routeIndex,
  conflictingObstacle,
}: {
  srj: Board
  routes: HighDensityRoute[]
  routeIndex: number
  conflictingObstacle: SimpleRouteJson["obstacles"][number]
}): Generator<HighDensityRoute[]> {
  const route = routes[routeIndex]!
  if (
    route.jumpers?.length ||
    route.route.some(
      (point) => point.toNextSegmentType || point.insideJumperPad,
    )
  ) {
    return
  }

  for (const reverse of [false, true]) {
    const points: RoutePoint[] = reverse
      ? [...route.route].reverse()
      : route.route
    const endpoint = points.at(-1)!
    const terminalPad = srj.obstacles.find(
      (obstacle) =>
        obstacle.shape === "circle" &&
        obstacle.layers.includes(mapZToLayerName(endpoint.z, srj.layerCount)) &&
        Math.hypot(
          endpoint.x - obstacle.center.x,
          endpoint.y - obstacle.center.y,
        ) <=
          Math.min(obstacle.width, obstacle.height) / 2 + 1e-6,
    )
    if (
      !terminalPad ||
      Math.hypot(
        endpoint.x - conflictingObstacle.center.x,
        endpoint.y - conflictingObstacle.center.y,
      ) > 1 ||
      terminalPad.componentId !== conflictingObstacle.componentId
    ) {
      continue
    }

    let innerEnd = points.length - 2
    while (innerEnd >= 0 && points[innerEnd]!.z === endpoint.z) innerEnd--
    if (innerEnd < 1) continue
    const oldVia = points[innerEnd]!
    const outerVia = points[innerEnd + 1]!
    if (Math.hypot(oldVia.x - outerVia.x, oldVia.y - outerVia.y) > 1e-6) {
      continue
    }
    let innerStart = innerEnd
    while (innerStart > 0 && points[innerStart - 1]!.z === oldVia.z) {
      innerStart--
    }
    if (points.slice(innerStart, -1).some((point) => point.pcb_port_id)) {
      continue
    }

    const traceThickness = Math.max(
      route.traceThickness,
      ...points
        .slice(innerStart)
        .map((point) => point.traceThickness ?? route.traceThickness),
    )
    const viaRadius = route.viaDiameter / 2
    const edgeMargin =
      Math.max(viaRadius, traceThickness / 2) + (srj.minBoardEdgeClearance ?? 0)
    for (const xFactor of OFFSET_FACTORS) {
      for (const yFactor of OFFSET_FACTORS) {
        const x = endpoint.x + xFactor * route.viaDiameter
        const y = endpoint.y + yFactor * route.viaDiameter
        if (
          x - edgeMargin < srj.bounds.minX ||
          x + edgeMargin > srj.bounds.maxX ||
          y - edgeMargin < srj.bounds.minY ||
          y + edgeMargin > srj.bounds.maxY
        ) {
          continue
        }
        // Even same-net pads must not receive a via-in-pad implicitly. The
        // evaluator separately enforces foreign-net pad/via clearances.
        if (
          srj.obstacles.some((obstacle) => {
            const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
            const deltaX = x - obstacle.center.x
            const deltaY = y - obstacle.center.y
            const dx = Math.abs(
              deltaX * Math.cos(angle) + deltaY * Math.sin(angle),
            )
            const dy = Math.abs(
              -deltaX * Math.sin(angle) + deltaY * Math.cos(angle),
            )
            const distance =
              obstacle.shape === "circle"
                ? Math.hypot(dx, dy) -
                  Math.min(obstacle.width, obstacle.height) / 2
                : Math.hypot(
                    Math.max(0, dx - obstacle.width / 2),
                    Math.max(0, dy - obstacle.height / 2),
                  )
            return distance < viaRadius - 1e-6
          })
        ) {
          continue
        }

        for (
          let anchorIndex = innerEnd;
          anchorIndex >= Math.max(innerStart, innerEnd - 7);
          anchorIndex--
        ) {
          const anchor = points[anchorIndex]!
          const previous = points[anchorIndex - 1]
          const canChangeLayer =
            anchorIndex === innerStart &&
            previous &&
            !previous.pcb_port_id &&
            Math.hypot(anchor.x - previous.x, anchor.y - previous.y) < 1e-6
          const targetLayers = canChangeLayer
            ? Array.from({ length: srj.layerCount }, (_, z) => z).filter(
                (z) => z !== endpoint.z && z !== previous.z,
              )
            : [oldVia.z]
          for (const targetZ of targetLayers) {
            for (const bend of ["direct", "x", "y", "45x", "45y"]) {
              const viaPoint = { x, y, z: targetZ, traceThickness }
              const diagonal = Math.min(
                Math.abs(x - anchor.x),
                Math.abs(y - anchor.y),
              )
              const bridge =
                bend === "direct"
                  ? []
                  : [
                      {
                        ...viaPoint,
                        x:
                          bend === "x"
                            ? x
                            : bend === "y"
                              ? anchor.x
                              : bend === "45x"
                                ? x - Math.sign(x - anchor.x) * diagonal
                                : anchor.x + Math.sign(x - anchor.x) * diagonal,
                        y: bend === "x" || bend === "45x" ? anchor.y : y,
                      },
                    ]
              const candidatePoints = [
                ...points.slice(0, anchorIndex),
                { ...anchor, z: targetZ },
                ...bridge,
                viaPoint,
                { ...viaPoint, z: endpoint.z },
                endpoint,
              ]
              const candidateRoutes = cloneRoutesForIndexes(routes, [
                routeIndex,
              ])
              candidateRoutes[routeIndex]!.route = reverse
                ? candidatePoints.reverse()
                : candidatePoints
              yield materializeRoutesForIndexes(candidateRoutes, [routeIndex])
            }
          }
        }
      }
    }
  }
}
