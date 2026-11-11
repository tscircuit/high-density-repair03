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

test("checks pad drills after restoring H616 DDR connections", async (): Promise<void> => {
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
  const snapshot = getDrcSnapshot(
    fixture.srj,
    output,
    undefined,
    connMap,
    engine,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output).toHaveLength(fixture.inputHdRoutes.length)
  const guard = new TraceContactGuard({
    srj: fixture.srj,
    inputRoutes: fixture.inputHdRoutes,
    connMap,
  })
  expect(guard.getNewContactPairs(output)).toEqual([])
  for (const route of output) {
    const input = fixture.inputHdRoutes.find(
      (input) => input.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(input.route[0])
    expect(route.route.at(-1)).toEqual(input.route.at(-1))
  }
  const drills = snapshot.errors.filter(
    (error) => error.type === "pcb_placement_error",
  )
  expect(drills).toEqual([])
  const board = new VisualizedGlobalDrcForceImproveSolver({
    srj: fixture.srj,
    hdRoutes: output,
    connMap,
  }).visualize()
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([board], {
        titles: [`H616 DDR | Forbidden pad drills: ${drills.length}`],
      }),
      { backgroundColor: "white", svgWidth: 1200, svgHeight: 1200 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
