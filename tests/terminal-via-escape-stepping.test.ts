import { expect, test } from "bun:test"
import { FinePitchPadEscapeSolver } from "../lib"
import { createTerminalViaEscapeRepro } from "../fixture-support/terminalViaEscapeRepro"

test("terminal via candidates perform no DRC until stepped and at most one evaluation per step", () => {
  const repro = createTerminalViaEscapeRepro()
  let evaluations = 0
  const solver = new FinePitchPadEscapeSolver({
    ...repro.solver.params,
    drcEvaluator: (input) => {
      evaluations++
      return repro.solver.params.drcEvaluator(input)
    },
  })
  expect(evaluations).toBe(0)
  solver.step()
  expect(solver.stats.remainingDrcIssueCount).toBeGreaterThan(0)
  while (!solver.solved && !solver.failed) {
    const previousEvaluations = evaluations
    solver.step()
    expect(evaluations - previousEvaluations).toBeLessThanOrEqual(1)
  }
  expect(solver.failed).toBe(false)
  expect(solver.getOutput().remainingErrors).toHaveLength(0)
})
