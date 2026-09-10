import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { expectSnapshot } from "./fixtures/rv1106-phased-repair/expectSnapshot"
import { loadAutoroutingPhases } from "./fixtures/rv1106-phased-repair/loadBoard"

test("RV1106 trace topology repair with remaining same-net via errors", () => {
  const phases = loadAutoroutingPhases()
  expect(phases.clocks.output).toHaveLength(11)
  expect(phases.bootFlash.input.traces).toEqual(phases.clocks.output)
  expect(phases.remaining.traces).toEqual(phases.bootFlash.output)
  const input: {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
    netMap: ConnectivityMap["netMap"]
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/rv1106-phased-repair/trace-topology-input.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    ...input,
    connMap: new ConnectivityMap(input.netMap),
    maxIterations: 32,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcIssueCount).toBe(143)
  expect(solver.stats.finalDrcIssueCount).toBe(129)
  const output = solver.getOutput()
  expect(output).toHaveLength(input.hdRoutes.length)
  for (const [index, route] of output.entries()) {
    expect(route.connectionName).toBe(input.hdRoutes[index]!.connectionName)
    expect(route.route[0]).toEqual(input.hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(input.hdRoutes[index]!.route.at(-1))
  }
  const graphics = solver.visualize()
  graphics.title = `RV1106 trace topology output: ${solver.stats.finalDrcIssueCount} repair03 reports`
  expectSnapshot({ graphics, name: "rv1106-trace-topology-output" })
})
