import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  TraceContactRepairSolver,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  createTraceViaShortInput,
  getTraceViaCopperGap,
} from "./fixtures/traceViaShort"

test("the deferred contact owner restores shorted connections without losing independent repairs", () => {
  const input = createTraceViaShortInput()
  const original = structuredClone(input)
  const engine = new AutoroutingDrcEngine(input.srj)
  const omitPairShort = ({
    traces,
  }: {
    traces: Parameters<AutoroutingDrcEngine["evaluate"]>[0]
  }) => {
    const evaluated = engine.evaluate(traces)
    const keepError = (error: (typeof evaluated.errors)[number]) =>
      error.pcb_trace_error_id !== "overlap_n2_0_via_3" &&
      error.pcb_trace_error_id !== "overlap_n2_0_n3_0" &&
      error.pcb_trace_error_id !== "overlap_n3_0_via_2"
    return {
      errors: evaluated.errors.filter(keepError),
      errorsWithCenters: evaluated.errorsWithCenters.filter(keepError),
    }
  }
  const intermediate = new GlobalDrcForceImproveSolver({
    ...input,
    maxIterations: 16,
    deferTraceContactGuard: true,
    drcEvaluator: omitPairShort,
  })
  intermediate.solve()
  const candidate = intermediate.getOutput()
  expect(getTraceViaCopperGap(candidate)).toBeLessThan(0)
  const owner = new TraceContactRepairSolver({
    ...input,
    hdRoutes: candidate,
    inputHdRoutes: input.hdRoutes,
    broadMaxIterations: 16,
    broadPassMultiplier: 1,
  })
  owner.solve()
  const output = owner.getOutput()
  expect(owner.solved).toBe(true)
  expect(owner.failed).toBe(false)
  expect(getTraceViaCopperGap(output)).toBeGreaterThanOrEqual(-1e-9)
  expect(getDrcSnapshot(input.srj, output).count).toBeLessThanOrEqual(2)
  for (const index of [0, 1, 4, 5]) {
    expect(output[index]).toEqual(candidate[index])
  }
  expect(input).toEqual(original)
})
