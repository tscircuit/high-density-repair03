import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type DrcError = Record<string, unknown>

export type DrcEvaluator = (input: {
  traces: SimplifiedPcbTraces
  srj?: SimpleRouteJson
  hdRoutes?: HighDensityRoute[]
  routes?: HighDensityRoute[]
}) =>
  | {
      errors: DrcError[]
      errorsWithCenters?: DrcError[]
      /** Maps evaluator-specific via ids back to the trace that owns them. */
      pcbViaTraceIdById?: Record<string, string>
      /** Maps evaluator-specific via ids back to their evaluated geometry. */
      pcbViaPositionById?: Record<string, { x: number; y: number }>
    }
  | DrcError[]

export type DrcSnapshot = {
  errors: DrcError[]
  count: number
  issueScore: number
  traceRouteIndexById: Map<string, number>
  viaRouteIndexById: Map<string, number>
  viaPositionById: Map<string, { x: number; y: number }>
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
