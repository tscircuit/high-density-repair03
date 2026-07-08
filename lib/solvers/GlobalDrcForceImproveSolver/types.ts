import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ConnectivityMapLike } from "./netUtils"

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
  connMap?: ConnectivityMapLike
  effort?: number
  drcEvaluator?: DrcEvaluator
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
}

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
