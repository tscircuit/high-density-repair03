import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { TraceContactRepairSolver } from "../lib"
import type { TraceContactRepairSolverParams } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactRepairSolver"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("restoring H616 contacts retains independent DDR repairs", () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/h616-ddr-before-contact-repair.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as TraceContactRepairSolverParams
  const independent = fixture.hdRoutes.find(
    (route) => route.connectionName === "source_net_209",
  )!
  const original = structuredClone(fixture)
  const solver = new TraceContactRepairSolver(fixture)
  solver.solve()

  const output = solver.getOutput()
  const inputGuard = new TraceContactGuard({
    srj: fixture.srj,
    inputRoutes: fixture.inputHdRoutes,
  })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(inputGuard.getNewContactPairs(output)).toEqual([])
  expect(
    output.find((route) => route.connectionName === independent.connectionName),
  ).toEqual(independent)
  expect(output).toHaveLength(fixture.inputHdRoutes.length)
  for (const route of output) {
    const input = fixture.inputHdRoutes.find(
      (input) => input.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(input.route[0])
    expect(route.route.at(-1)).toEqual(input.route.at(-1))
  }
  expect(getDrcSnapshot(fixture.srj, output).count).toBeLessThanOrEqual(
    getDrcSnapshot(fixture.srj, fixture.inputHdRoutes).count,
  )
  expect(fixture).toEqual(original)
})
