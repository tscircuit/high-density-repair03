import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AutoroutingDrcEngine } from "../../drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type DrcError = Record<string, unknown>

export type DrcEvaluatorInput = {
  traces: SimplifiedPcbTraces
  srj?: SimpleRouteJson
  hdRoutes?: HighDensityRoute[]
  routes?: HighDensityRoute[]
}

export type DrcEvaluatorResult =
  | { errors: DrcError[]; errorsWithCenters?: DrcError[] }
  | DrcError[]

export type DrcEvaluatorFunction = (
  input: DrcEvaluatorInput,
) => DrcEvaluatorResult

export type DrcEvaluator = DrcEvaluatorFunction & {
  /** Staged evaluator for the established DRC set before via-to-pad repair. */
  evaluateLegacy?: DrcEvaluatorFunction
  /** Returns a previously computed result for the exact route geometry. */
  getCachedResult?: (input: DrcEvaluatorInput) => DrcEvaluatorResult | undefined
}

export type DrcSnapshot = {
  errors: DrcError[]
  count: number
  issueScore: number
  legacyIssueScore?: number
  traceRouteIndexById: Map<string, number>
}

export type GlobalDrcForceImproveSolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  connMap?: ConnectivityMap
  effort?: number
  drcEvaluator?: DrcEvaluator
  /**
   * Optional independent DRC evaluator used to reject an output that is worse
   * than the solver input under the caller's final acceptance criteria.
   */
  referenceDrcEvaluator?: DrcEvaluator
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
