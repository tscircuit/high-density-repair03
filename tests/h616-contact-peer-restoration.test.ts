import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import "bun-match-svg"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { AutoroutingDrcEngine, TraceContactRepairSolver } from "../lib"
import type { TraceContactRepairSolverParams } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactRepairSolver"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("retains safe peer repairs on the H616 DDR board", async () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-contact-peer-restoration.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as TraceContactRepairSolverParams & { netMap: Record<string, string[]> }
  const original = structuredClone(fixture)
  const connMap = new ConnectivityMap(fixture.netMap)
  const engine = new AutoroutingDrcEngine(fixture.srj, {
    connMap,
    traceClearance: 0.1,
    viaToPadClearance: 0.1,
    viaClearance: 0.1,
  })
  const solver = new TraceContactRepairSolver({
    ...fixture,
    connMap,
    autoroutingDrcEngine: engine,
  })
  solver.solve()
  const output = solver.getOutput()
  const inputGuard = new TraceContactGuard({
    srj: fixture.srj,
    inputRoutes: fixture.inputHdRoutes,
    connMap,
  })
  const snapshot = getDrcSnapshot(
    fixture.srj,
    output,
    undefined,
    connMap,
    engine,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(inputGuard.getNewContactPairs(output)).toEqual([])
  expect(output).toHaveLength(fixture.inputHdRoutes.length)
  for (const route of output) {
    const input = fixture.inputHdRoutes.find(
      (input) => input.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(input.route[0])
    expect(route.route.at(-1)).toEqual(input.route.at(-1))
  }
  expect(fixture).toEqual(original)
  const board = new VisualizedGlobalDrcForceImproveSolver({
    srj: fixture.srj,
    hdRoutes: output,
    connMap,
  }).visualize()
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([board], {
        titles: [`H616 DDR contact repair | DRC findings: ${snapshot.count}`],
      }),
      { backgroundColor: "white", svgWidth: 1200, svgHeight: 1200 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
