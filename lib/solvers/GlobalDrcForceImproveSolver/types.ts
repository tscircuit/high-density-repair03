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
  enableLargeBoardBroadFallback?: boolean
  /**
   * Evaluates route-disjoint DRC repairs as an additional candidate family.
   * Disable this for coarse pipeline stages whose DRC evaluator is not the
   * final acceptance objective.
   */
  enableRouteDisjointBatching?: boolean
  enableTargetedErrorSweep?: boolean
  enablePostSolveClearanceRelaxation?: boolean
  enableSafeTraceLayerMoves?: boolean
  enableViaInPadLayerMoves?: boolean
}

export type GlobalDrcBranchPortfolioSolverParams =
  GlobalDrcForceImproveSolverParams & {
    broadMaxIterations: number
    broadPassMultiplier: number
    viaInPadDrcEvaluator?: DrcEvaluator
    viaInPadMaxIterations?: number
  }

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
