import type { DrcSnapshot } from "../../lib/solvers/GlobalDrcForceImproveSolver/types"

export const padError = ({
  pad,
  clearance,
  ...extra
}: { pad: string; clearance: number } & Record<string, unknown>): Record<
  string,
  unknown
> => ({
  type: "pcb_trace_error",
  pcb_trace_error_id: `overlap_trace_0_${pad}`,
  pcb_trace_id: "trace_0",
  message: `PCB trace trace_0 is too close to pcb_smtpad "${pad}"`,
  actual_clearance: clearance,
  ...extra,
})

export const snapshot = (
  errors: Record<string, unknown>[],
  issueScore = errors.length,
): DrcSnapshot => ({
  errors,
  count: errors.length,
  issueScore,
  legacyIssueScore: issueScore,
  traceRouteIndexById: new Map([["trace_0", 0]]),
})
