import { expect, test } from "bun:test"
import { FinePitchPadEscapeSolver } from "../lib"
import { createPedometerPadEscapeRepro } from "../fixture-support/pedometerPadEscapeRepro"

test("pad escape DRC failures surface from step instead of publishing a result", () => {
  const repro = createPedometerPadEscapeRepro()
  const solver = new FinePitchPadEscapeSolver({
    ...repro.solver.params,
    drcEvaluator: () => {
      throw new Error("DRC unavailable")
    },
  })
  expect(solver.failed).toBe(false)
  expect(() => solver.step()).toThrow("DRC unavailable")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow("before solved")
})
