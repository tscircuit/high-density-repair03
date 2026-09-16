import { expect, test } from "bun:test"
import { FinePitchPadEscapeSolver } from "../lib"
import { createPedometerPadEscapeRepro } from "../fixture-support/pedometerPadEscapeRepro"

test("an exhausted pad escape search yields between candidates and preserves the input", () => {
  const repro = createPedometerPadEscapeRepro()
  let evaluations = 0
  const solver = new FinePitchPadEscapeSolver({
    ...repro.solver.params,
    drcEvaluator: () => {
      evaluations++
      return repro.initialErrors
    },
  })
  while (!solver.solved && !solver.failed) {
    const before = evaluations
    solver.step()
    expect(evaluations - before).toBeLessThanOrEqual(1)
  }
  expect(solver.failed).toBe(false)
  expect(evaluations).toBeGreaterThan(100)
  expect(solver.getOutput().acceptedCandidateCount).toBe(0)
  expect(solver.getOutput().routes).toBe(repro.routes)
  expect(solver.getOutput().remainingErrors).toEqual(repro.initialErrors)
})
