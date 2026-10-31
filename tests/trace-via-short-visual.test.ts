import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
} from "../lib"
import { getTraceViaShortGraphics } from "./fixtures/getTraceViaShortGraphics"
import {
  createTraceViaShortInput,
  getTraceViaCopperGap,
} from "./fixtures/traceViaShort"

test("snapshots the input and published trace-to-via copper gap", async () => {
  for (const [name, Solver] of [
    ["global", GlobalDrcForceImproveSolver],
    ["portfolio", GlobalDrcBranchPortfolioSolver],
  ] as const) {
    const input = createTraceViaShortInput()
    const solver = new Solver({
      ...input,
      maxIterations: 16,
      broadMaxIterations: 16,
      broadPassMultiplier: 1,
      enablePostSolveClearanceRelaxation: false,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.getOutput()
    const graphics = stackGraphicsHorizontally(
      [
        getTraceViaShortGraphics(input.hdRoutes),
        getTraceViaShortGraphics(output),
      ],
      {
        titles: [
          `Input: gap ${getTraceViaCopperGap(input.hdRoutes).toFixed(5)} mm`,
          `${name} output: gap ${getTraceViaCopperGap(output).toFixed(5)} mm`,
        ],
      },
    )
    await expect(
      getSvgFromGraphicsObject(graphics, {
        backgroundColor: "white",
        svgWidth: 1400,
        svgHeight: 350,
      }),
    ).toMatchSvgSnapshot(import.meta.path, name)
  }
})
