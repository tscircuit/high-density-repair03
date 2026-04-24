import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  DrcSnapshot,
  GlobalDrcForceImproveSolverParams,
  HighDensityRoute,
  SolverOutput,
} from "./types"

const ERROR_MATCH_TOLERANCE = 0.08

const getLayerStrokeColor = (z: number, layerCount: number) => {
  if (z === 0) return "#dc2626"
  if (z === layerCount - 1) return "#2563eb"
  const innerPalette = ["#eab308", "#f59e0b", "#f97316", "#fb923c"]
  return innerPalette[(z - 1) % innerPalette.length] ?? "#f59e0b"
}

const getErrorLabel = (error: Record<string, unknown>) => {
  const type =
    typeof error.pcb_error_id === "string"
      ? error.pcb_error_id
      : typeof error.type === "string"
        ? error.type
        : "drc-error"
  const message = typeof error.message === "string" ? error.message : ""
  return message ? `${type}: ${message}` : type
}

export class GlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: GlobalDrcForceImproveSolverParams["srj"]
  readonly inputHdRoutes: GlobalDrcForceImproveSolverParams["hdRoutes"]
  readonly effort: number
  readonly drcEvaluator: GlobalDrcForceImproveSolverParams["drcEvaluator"]
  readonly visibleLayer: NonNullable<
    GlobalDrcForceImproveSolverParams["visibleLayer"]
  >
  readonly deps: GlobalDrcForceImproveSolverParams["deps"]
  outputHdRoutes: HighDensityRoute[]

  private bestHdRoutes: HighDensityRoute[]
  private bestSnapshot?: DrcSnapshot
  private initialSnapshot?: DrcSnapshot

  constructor(params: GlobalDrcForceImproveSolverParams) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.effort = params.effort ?? 1
    this.drcEvaluator = params.drcEvaluator
    this.visibleLayer = params.visibleLayer ?? "all"
    this.deps = params.deps
    this.outputHdRoutes = params.hdRoutes
    this.bestHdRoutes = params.hdRoutes
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams() {
    return [
      {
        srj: this.srj,
        hdRoutes: this.inputHdRoutes,
        effort: this.effort,
        drcEvaluator: this.drcEvaluator,
        visibleLayer: this.visibleLayer,
        deps: this.deps,
      },
    ] as const
  }

  override _step() {
    let bestRoutes = this.inputHdRoutes
    let bestSnapshot = this.deps.getDrcSnapshot(
      this.srj,
      bestRoutes,
      this.drcEvaluator,
    )
    let bestIssueCount = bestSnapshot.count
    let bestIssueScore = bestSnapshot.issueScore
    let bestViaIssueCount = this.deps.getViaDrcIssueCount(bestSnapshot)
    const initialDrcIssueCount = bestIssueCount
    let broadForceAccepted = false
    let targetedForceAccepted = false
    let candidateAttempts = 0

    this.initialSnapshot = bestSnapshot

    if (bestIssueCount > 0) {
      const broadCandidateRoutes = this.deps.applyBroadRepulsionForces(
        this.srj,
        bestRoutes,
        this.effort,
      )
      const broadCandidateSnapshot = this.deps.getDrcSnapshot(
        this.srj,
        broadCandidateRoutes,
        this.drcEvaluator,
      )
      const broadCandidateViaIssueCount = this.deps.getViaDrcIssueCount(
        broadCandidateSnapshot,
      )

      if (
        broadCandidateSnapshot.count < bestIssueCount ||
        (broadCandidateSnapshot.count === bestIssueCount &&
          broadCandidateSnapshot.issueScore < bestIssueScore) ||
        (broadCandidateSnapshot.count === bestIssueCount &&
          broadCandidateViaIssueCount < bestViaIssueCount)
      ) {
        bestRoutes = broadCandidateRoutes
        bestSnapshot = broadCandidateSnapshot
        bestIssueCount = broadCandidateSnapshot.count
        bestIssueScore = broadCandidateSnapshot.issueScore
        bestViaIssueCount = broadCandidateViaIssueCount
        broadForceAccepted = true
      }
    }

    const maxPasses = this.deps.getMaxPassesForEffort(this.effort)
    const maxCandidateAttempts = this.deps.getMaxCandidateAttemptsForEffort(
      this.effort,
    )

    for (
      let pass = 0;
      pass < maxPasses &&
      bestIssueCount > 0 &&
      candidateAttempts < maxCandidateAttempts;
      pass += 1
    ) {
      const centeredErrors = this.deps.getCenteredErrors(bestSnapshot.errors)
      if (centeredErrors.length === 0) break

      let acceptedCandidate = false

      for (const scale of this.deps.getForceScalesForEffort(this.effort)) {
        if (candidateAttempts >= maxCandidateAttempts) break

        const candidateRoutes = this.deps.cloneRoutes(bestRoutes)
        const changed = this.deps.applyDrcErrorForces(
          this.srj,
          candidateRoutes,
          centeredErrors,
          bestSnapshot.traceRouteIndexById,
          scale,
        )
        if (!changed) continue

        candidateAttempts += 1
        const materializedCandidateRoutes =
          this.deps.materializeRoutes(candidateRoutes)
        const candidateSnapshot = this.deps.getDrcSnapshot(
          this.srj,
          materializedCandidateRoutes,
          this.drcEvaluator,
        )
        const candidateViaIssueCount =
          this.deps.getViaDrcIssueCount(candidateSnapshot)

        if (
          candidateSnapshot.count < bestIssueCount ||
          (candidateSnapshot.count === bestIssueCount &&
            candidateSnapshot.issueScore < bestIssueScore) ||
          (candidateSnapshot.count === bestIssueCount &&
            candidateViaIssueCount < bestViaIssueCount)
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = candidateSnapshot.count
          bestIssueScore = candidateSnapshot.issueScore
          bestViaIssueCount = candidateViaIssueCount
          targetedForceAccepted = true
          acceptedCandidate = true
          break
        }
      }

      if (!acceptedCandidate) break
    }

    this.outputHdRoutes = bestRoutes
    this.bestHdRoutes = bestRoutes
    this.bestSnapshot = bestSnapshot
    this.stats = {
      initialDrcIssueCount,
      finalDrcIssueCount: bestIssueCount,
      globalDrcForceImproveBroadForceAccepted: broadForceAccepted,
      globalDrcForceImproveTargetedForceAccepted: targetedForceAccepted,
      globalDrcForceImproveCandidateAttempts: candidateAttempts,
      bestIssueScore,
      bestViaIssueCount,
      effort: this.effort,
    }
    this.solved = true
  }

  override getOutput(): SolverOutput {
    return {
      hdRoutes: this.bestHdRoutes,
      drc:
        this.bestSnapshot ??
        this.deps.getDrcSnapshot(
          this.srj,
          this.bestHdRoutes,
          this.drcEvaluator,
        ),
    }
  }

  override visualize(): GraphicsObject {
    const routes = this.outputHdRoutes
    const visibleLayer = this.visibleLayer
    const layerVisible = (z: number) =>
      visibleLayer === "all" ||
      this.deps.mapZToLayerName(z, this.srj.layerCount) === visibleLayer
    const obstacleVisible = (obstacle: (typeof this.srj.obstacles)[number]) =>
      visibleLayer === "all" ||
      obstacle.layers.includes(visibleLayer) ||
      obstacle.zLayers?.some((z) => layerVisible(z))
    const fallbackSnapshot =
      this.bestSnapshot ??
      this.initialSnapshot ??
      this.deps.getDrcSnapshot(this.srj, this.outputHdRoutes, this.drcEvaluator)

    const getErrorKey = (error: Record<string, unknown>) => {
      const center = this.deps.getErrorCenter(error)
      const traceId =
        typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : "trace?"
      const viaIds = Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.join(",")
        : ""
      return center
        ? `${traceId}|${viaIds}|${center.x.toFixed(2)}|${center.y.toFixed(2)}`
        : `${traceId}|${viaIds}|nocenter`
    }

    const errorsMatch = (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ) => {
      const leftCenter = this.deps.getErrorCenter(left)
      const rightCenter = this.deps.getErrorCenter(right)
      if (!leftCenter || !rightCenter)
        return getErrorKey(left) === getErrorKey(right)

      const sameTraceId =
        (typeof left.pcb_trace_id === "string" ? left.pcb_trace_id : "") ===
        (typeof right.pcb_trace_id === "string" ? right.pcb_trace_id : "")
      const closeEnough =
        Math.hypot(
          leftCenter.x - rightCenter.x,
          leftCenter.y - rightCenter.y,
        ) <= ERROR_MATCH_TOLERANCE

      return sameTraceId
        ? closeEnough
        : closeEnough && getErrorKey(left) === getErrorKey(right)
    }

    const initialErrors = this.deps.getCenteredErrors(
      this.initialSnapshot?.errors ?? fallbackSnapshot.errors,
    )
    const bestErrors = this.deps.getCenteredErrors(
      (this.bestSnapshot ?? fallbackSnapshot).errors,
    )
    const fixedErrors = initialErrors.filter(
      (initialError) =>
        !bestErrors.some((bestError) => errorsMatch(initialError, bestError)),
    )

    const drcCircles = [
      ...fixedErrors.flatMap((error) => {
        const center = this.deps.getErrorCenter(error)
        if (!center) return []
        return [
          {
            center,
            radius: 0.34,
            stroke: "#16a34a",
            fill: "rgba(34, 197, 94, 0.10)",
            label: `fixed ${getErrorLabel(error)}`,
          },
          {
            center,
            radius: 0.16,
            stroke: "#15803d",
            fill: "rgba(34, 197, 94, 0.30)",
            label: `fixed ${getErrorLabel(error)}`,
          },
        ]
      }),
      ...bestErrors.flatMap((error) => {
        const center = this.deps.getErrorCenter(error)
        if (!center) return []
        return [
          {
            center,
            radius: 0.34,
            stroke: "#7c3aed",
            fill: "rgba(124, 58, 237, 0.12)",
            label: getErrorLabel(error),
          },
          {
            center,
            radius: 0.16,
            stroke: "#6d28d9",
            fill: "rgba(124, 58, 237, 0.36)",
            label: getErrorLabel(error),
          },
        ]
      }),
    ]

    return {
      points: routes.flatMap((route, routeIndex) =>
        route.route.flatMap((point, pointIndex) => {
          if (!layerVisible(point.z)) return []
          if (pointIndex !== 0 && pointIndex !== route.route.length - 1)
            return []
          return [
            {
              x: point.x,
              y: point.y,
              color: "#111827",
              label: `${route.connectionName}:${routeIndex}:${pointIndex}:z${point.z}`,
            },
          ]
        }),
      ),
      lines: routes.flatMap((route) =>
        route.route.slice(0, -1).flatMap((start, index) => {
          const end = route.route[index + 1]!
          if (start.z !== end.z || !layerVisible(start.z)) return []
          return [
            {
              points: [start, end],
              strokeColor: getLayerStrokeColor(start.z, this.srj.layerCount),
              strokeWidth: route.traceThickness ?? this.srj.minTraceWidth,
              label: `${route.connectionName} ${start.z === 0 ? "top" : start.z === this.srj.layerCount - 1 ? "bottom" : `inner${start.z}`}`,
            },
          ]
        }),
      ),
      rects: this.srj.obstacles.filter(obstacleVisible).map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        stroke: "#94a3b8",
        fill: "rgba(148, 163, 184, 0.06)",
      })),
      circles: routes
        .flatMap((route) =>
          route.vias.flatMap((via) => {
            const touchingVisibleLayer = route.route.some(
              (point) =>
                Math.abs(point.x - via.x) <= 1e-3 &&
                Math.abs(point.y - via.y) <= 1e-3 &&
                layerVisible(point.z),
            )
            if (!touchingVisibleLayer) return []
            return [
              {
                center: via,
                radius: Math.max(
                  (route.viaDiameter ?? this.srj.minViaDiameter ?? 0.3) / 2,
                  0.18,
                ),
                stroke: "#111827",
                fill: "rgba(255,255,255,0.9)",
                label: `${route.connectionName} via`,
              },
            ]
          }),
        )
        .concat(drcCircles),
      texts: [
        {
          x: this.srj.bounds.minX,
          y: this.srj.bounds.maxY,
          text: `layer=${visibleLayer} errors=${(this.bestSnapshot ?? fallbackSnapshot).count} fixed=${fixedErrors.length} score=${(this.bestSnapshot ?? fallbackSnapshot).issueScore.toFixed(3)}`,
          color: "#111827",
        },
      ],
    }
  }
}
