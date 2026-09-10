import { expect, test } from "bun:test"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { AutoroutingDrcEngine } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { expectSnapshot } from "./fixtures/rv1106-phased-repair/expectSnapshot"
import {
  loadAutoroutingPhases,
  loadBoard,
} from "./fixtures/rv1106-phased-repair/loadBoard"

test("RV1106 targeted repair visits the remaining same-net via pairs", () => {
  const phases = loadAutoroutingPhases()
  expect(phases.clocks.output).toHaveLength(11)
  expect(phases.bootFlash.input.traces).toEqual(phases.clocks.output)
  expect(phases.bootFlash.output).toHaveLength(21)
  expect(phases.remaining.traces).toEqual(phases.bootFlash.output)
  expect(phases.remaining.connections).toHaveLength(36)
  const input = loadBoard()
  const engine = new AutoroutingDrcEngine(input.srj, { connMap: input.connMap })
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    ...input,
    autoroutingDrcEngine: engine,
    maxIterations: 32,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    enablePostSolveClearanceRelaxation: false,
  })
  const initial = solver.visualize()
  initial.title = "RV1106 targeted repair input: 147 reports"
  expectSnapshot({ graphics: initial, name: "rv1106-via-priority-input" })
  solver.solve()
  const output = solver.getOutput()
  const after = getDrcSnapshot(
    input.srj,
    output,
    undefined,
    input.connMap,
    engine,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcIssueCount).toBe(147)
  expect(after.count).toBe(141)
  expect(output).toHaveLength(input.hdRoutes.length)
  for (const [index, route] of output.entries()) {
    expect(route.connectionName).toBe(input.hdRoutes[index]!.connectionName)
    expect(route.route[0]).toEqual(input.hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(input.hdRoutes[index]!.route.at(-1))
  }
  const graphics = solver.visualize()
  graphics.title = `RV1106 targeted repair output: ${after.count} reports`
  expectSnapshot({ graphics, name: "rv1106-via-priority-output" })
})
