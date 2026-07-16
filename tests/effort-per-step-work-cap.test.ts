import { expect, test } from "bun:test"
import {
  getBroadForcePassesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  getMaxTargetedErrorsPerStepForEffort,
  getMaxTargetedSweepErrorsForEffort,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"

test("effort extends DRC iterations without multiplying work per step", () => {
  expect(getMaxTargetedCandidateAttemptsForEffort(100)).toBe(
    getMaxTargetedCandidateAttemptsForEffort(1),
  )
  expect(getMaxTargetedErrorsPerStepForEffort(100)).toBe(
    getMaxTargetedErrorsPerStepForEffort(1),
  )
  expect(getMaxTargetedSweepErrorsForEffort(100)).toBe(
    getMaxTargetedSweepErrorsForEffort(1),
  )
  expect(getBroadForcePassesForEffort(100, 2)).toBe(
    getBroadForcePassesForEffort(1, 2),
  )
})
