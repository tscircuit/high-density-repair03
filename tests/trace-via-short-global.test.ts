import { beforeAll, expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import {
  createTraceViaShortInput,
  getTraceViaCopperGap,
} from "./fixtures/traceViaShort"

const outputGaps: number[] = []

beforeAll(() => {
  for (const enablePostSolveClearanceRelaxation of [false, true]) {
    const input = createTraceViaShortInput()
    const original = structuredClone(input)
    expect(getTraceViaCopperGap(input.hdRoutes)).toBeGreaterThan(0.05)
    const solver = new GlobalDrcForceImproveSolver({
      ...input,
      maxIterations: 16,
      enablePostSolveClearanceRelaxation,
    })
    solver.solve()
    const output = solver.getOutput()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(input).toEqual(original)
    expect(output).toHaveLength(input.hdRoutes.length)
    expect(solver.stats.initialDrcIssueCount).toBe(5)
    expect(solver.stats.finalDrcIssueCount).toBeLessThanOrEqual(5)
    for (let index = 0; index < output.length; index++) {
      expect(output[index]!.route[0]).toEqual(input.hdRoutes[index]!.route[0])
      expect(output[index]!.route.at(-1)).toEqual(
        input.hdRoutes[index]!.route.at(-1),
      )
    }
    outputGaps.push(getTraceViaCopperGap(output))
  }
})

test.failing("global repair does not publish a new different-net trace-to-via short", () => {
  for (const gap of outputGaps) expect(gap).toBeGreaterThanOrEqual(-1e-9)
})
