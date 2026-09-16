import { expect, test } from "bun:test"
import { FinePitchPadEscapeSolver, type DrcEvaluator } from "../lib"
import { createPedometerPadEscapeRepro } from "../fixture-support/pedometerPadEscapeRepro"

test("pad escape search is inert until stepped and evaluates at most one candidate per step", () => {
  const repro = createPedometerPadEscapeRepro()
  let evaluations = 0
  const drcEvaluator: DrcEvaluator = (input) => {
    evaluations++
    return repro.solver.params.drcEvaluator(input)
  }
  const solver = new FinePitchPadEscapeSolver({
    ...repro.solver.params,
    drcEvaluator,
  })
  expect(evaluations).toBe(0)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow("before solved")
  expect(solver.getConstructorParams()[0].routes).toBe(repro.routes)
  solver.visualize()
  expect(evaluations).toBe(0)

  solver.step()
  expect(evaluations).toBe(1)
  expect(solver.solved).toBe(false)
  expect(solver.stats.attemptedCandidateCount).toBe(0)
  const pausedEvaluations = evaluations
  solver.visualize()
  expect(evaluations).toBe(pausedEvaluations)

  while (!solver.solved && !solver.failed) {
    const before = evaluations
    solver.step()
    expect(evaluations - before).toBeLessThanOrEqual(1)
  }
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeGreaterThan(2)
  expect(solver.progress).toBe(1)
  expect(solver.getOutput()).toEqual(repro.result)
})
