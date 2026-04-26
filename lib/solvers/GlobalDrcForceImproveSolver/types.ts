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

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
