import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
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
  viaHoleDiameter?: number
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
  enableTargetedErrorSweep?: boolean
  enablePostSolveClearanceRelaxation?: boolean
  targetedErrorStartOffset?: number
  forceScales?: readonly number[]
  targetedSweepScale?: number
  enableViaInPadLayerMoves?: boolean
}

export type GlobalDrcBranchPortfolioSolverParams =
  GlobalDrcForceImproveSolverParams & {
    broadMaxIterations: number
    broadPassMultiplier: number
    additionalCandidateHdRoutes?: readonly HighDensityRoute[][]
    /**
     * Optional stricter evaluator used only to rank portfolio checkpoints.
     * Branch solvers continue to use drcEvaluator for movable repair targets.
     */
    validationDrcEvaluator?: DrcEvaluator
    viaInPadDrcEvaluator?: DrcEvaluator
    viaInPadMaxIterations?: number
  }

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
