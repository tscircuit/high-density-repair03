import { expect, test } from "bun:test"
import { shouldTryIndependentDrcErrorBatch } from "../lib/solvers/GlobalDrcForceImproveSolver/independentDrcErrorBatch"
import {
  BROAD_FALLBACK_SMALL_ROUTE_LIMIT,
  LARGE_DRC_COUNT_THRESHOLD,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"

test("defers independent batches to the existing small-board broad repair", () => {
  expect(
    shouldTryIndependentDrcErrorBatch({
      routeCount: BROAD_FALLBACK_SMALL_ROUTE_LIMIT,
      initialDrcIssueCount: LARGE_DRC_COUNT_THRESHOLD,
      batchSize: 2,
    }),
  ).toBe(false)
  expect(
    shouldTryIndependentDrcErrorBatch({
      routeCount: BROAD_FALLBACK_SMALL_ROUTE_LIMIT + 1,
      initialDrcIssueCount: LARGE_DRC_COUNT_THRESHOLD,
      batchSize: 2,
    }),
  ).toBe(true)
})
