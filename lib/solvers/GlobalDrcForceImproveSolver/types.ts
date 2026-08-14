import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AutoroutingDrcEngine } from "../../drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type DrcError = Record<string, unknown>

export type DrcEvaluator = (input: {
  traces: SimplifiedPcbTraces
  srj?: SimpleRouteJson
  hdRoutes?: HighDensityRoute[]
  routes?: HighDensityRoute[]
}) => { errors: DrcError[]; errorsWithCenters?: DrcError[] } | DrcError[]

export type DrcSnapshot = {
  errors: DrcError[]
  count: number
  issueScore: number
  traceRouteIndexById: Map<string, number>
}

export type GlobalDrcForceImproveSolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  connMap?: ConnectivityMap
  effort?: number
  drcEvaluator?: DrcEvaluator
  /**
   * Reusable optimized evaluator for the autorouting hot path. A new engine is
   * created automatically when neither this nor `drcEvaluator` is provided.
   */
  autoroutingDrcEngine?: AutoroutingDrcEngine
  viaHoleDiameter?: number
  maxIterations?: number
  /**
   * Whether each targeted solver iteration may try a speculative broad-force
   * candidate after targeted candidates fail. Defaults to true.
   */
  enableBroadFallback?: boolean
  enableLargeBoardBroadFallback?: boolean
  enableTargetedErrorSweep?: boolean
  enablePostSolveClearanceRelaxation?: boolean
  enableSafeTraceLayerMoves?: boolean
  /** Internal fixed-search branch ordering for safe trace-layer candidates. */
  safeTraceLayerVariantOrder?: "automatic" | "local_first" | "full_first"
  enableViaInPadLayerMoves?: boolean
  /** Internal portfolio phase that only applies DRC-scored planar repairs. */
  repairMode?: "default" | "safe_topology_only"
}

export type GlobalDrcBranchPortfolioSolverParams = Omit<
  GlobalDrcForceImproveSolverParams,
  "repairMode"
> & {
  broadMaxIterations: number
  broadPassMultiplier: number
  viaInPadDrcEvaluator?: DrcEvaluator
  viaInPadMaxIterations?: number
}

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
