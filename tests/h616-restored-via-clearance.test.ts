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
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

type Fixture = TraceContactRepairSolverParams & Pick<ConnectivityMap, "netMap">

test("preserves via clearance when restoring H616 DDR contacts", async (): Promise<void> => {
  // Real H616 control routing after physical round-pad width selection.
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-restored-via-clearance.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as Fixture
  const connMap = new ConnectivityMap(fixture.netMap)
  const engine = new AutoroutingDrcEngine(fixture.srj, {
    connMap,
    traceClearance: 0.1,
    viaToPadClearance: 0.1,
    viaClearance: 0.1,
    includeTraceViaOwnerMetadata: true,
  })
  const solver = new TraceContactRepairSolver({
    ...fixture,
    connMap,
    autoroutingDrcEngine: engine,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const snapshot = getDrcSnapshot(
    fixture.srj,
    output,
    undefined,
    connMap,
    engine,
  )
  expect(snapshot.traceConnectionNameById).toBeDefined()
  const clearanceErrors = snapshot.errors.filter((error): boolean => {
    if (!Array.isArray(error.pcb_trace_ids)) return false
    const owners = error.pcb_trace_ids.map((id: string): string | undefined =>
      snapshot.traceConnectionNameById!.get(id),
    )
    return (
      owners.includes("source_net_172") && owners.includes("source_net_13_mst2")
    )
  })
  expect(clearanceErrors).toEqual([])
  expect(snapshot.count).toBeLessThan(26)
  const board = new VisualizedGlobalDrcForceImproveSolver({
    srj: fixture.srj,
    hdRoutes: output,
    connMap,
  }).visualize()
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([board], {
        titles: [
          `H616 DDR | DRC findings: ${snapshot.count} | Restored via findings: ${clearanceErrors.length}`,
        ],
      }),
      { backgroundColor: "white", svgWidth: 1200, svgHeight: 1200 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
