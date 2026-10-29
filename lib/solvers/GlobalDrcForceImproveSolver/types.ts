import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AutoroutingDrcEngine } from "../../drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"

export type DrcError = Record<string, unknown>
export type PcbTraceId = SimplifiedPcbTraces[number]["pcb_trace_id"]

export type DrcEvaluatorInput = {
  traces: SimplifiedPcbTraces
  srj?: SimpleRouteJson
  hdRoutes?: HighDensityRoute[]
  routes?: HighDensityRoute[]
}

/**
 * Trace-obstacle contacts should include pcb_trace_id and a stable obstacle ID
 * (pcb_pad_id, pcb_smtpad_id, etc., or the obstacle ID quoted in the message).
 * Trace IDs should match the supplied traces, or be stable caller-owned IDs.
 * Opaque error IDs are not pair identities. Unidentifiable contacts are
 * conservatively treated as new by the overlap output guard.
 */
export type DrcEvaluatorResult =
  | { errors: DrcError[]; errorsWithCenters?: DrcError[] }
  | DrcError[]

export type DrcEvaluatorFunction = ((
  input: DrcEvaluatorInput,
) => DrcEvaluatorResult) & {
  /**
   * Opt in when the evaluator uses only routes/hdRoutes and supplies its own
   * prepared SRJ and trace context. Skips connectivity normalization of srj
   * and supplies empty traces; evaluators must not read or mutate the supplied
   * srj or traces in this mode.
   */
  inputMode?: "routes-only"
}

export type DrcEvaluator = DrcEvaluatorFunction & {
  /** Staged evaluator for the established DRC set before via-to-pad repair. */
  evaluateLegacy?: DrcEvaluatorFunction
  /** Returns a previously computed result for the exact route geometry. */
  getCachedResult?: (input: DrcEvaluatorInput) => DrcEvaluatorResult | undefined
}

export type DrcSnapshot = {
  /** Complete evaluator results, including errors omitted from force targeting. */
  rawErrors?: DrcError[]
  errors: DrcError[]
  count: number
  issueScore: number
  legacyIssueScore?: number
  traceRouteIndexById: Map<string, number>
  /** Logical source connections stay stable when their route fragments change. */
  traceConnectionNameById?: Map<PcbTraceId, string>
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
  /**
   * Intermediate stages only: the owning pipeline must check physical peer
   * contacts against its original input before publishing its final output.
   * Standalone solvers retain the physical publication guard by default.
   */
  deferTraceContactGuard?: boolean
  /**
   * Use enriched trace/via ownership metadata to target only a movable via
   * owner when the opposing trace is fixed. Defaults to false so callers keep
   * the legacy paired trace/via force behavior unless they explicitly opt in.
   */
  enableTraceViaOwnerTargeting?: boolean
}

export type GlobalDrcBranchPortfolioSolverParams =
  GlobalDrcForceImproveSolverParams & {
    broadMaxIterations: number
    broadPassMultiplier: number
    viaInPadDrcEvaluator?: DrcEvaluator
    viaInPadMaxIterations?: number
    /** Send multiple new shorts to the owning contact repair before mixed topology search. */
    prioritizeMultipleTraceContactRepair?: boolean
  }

export type SolverDeps = Record<string, unknown>

export type SolverOutput = HighDensityRoute[]
