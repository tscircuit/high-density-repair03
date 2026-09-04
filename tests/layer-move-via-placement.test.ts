import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import fixture from "./fixtures/repair-via-safety-before.json"

test("a layer repair places its vias clear of foreign pads before acceptance", () => {
  const srj = fixture.srj as SimpleRouteJson
  const inputRoutes: HighDensityRoute[] = structuredClone(fixture.inputRoutes)
  const engine = new AutoroutingDrcEngine(srj)
  expect(
    getDrcSnapshot(srj, inputRoutes, undefined, undefined, engine).count,
  ).toBe(1)

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    ...fixture.solverOptions,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  expect(output.flatMap((route) => route.vias)).toHaveLength(2)
  expect(
    getDrcSnapshot(srj, output, undefined, undefined, engine).errors,
  ).toEqual([])
  for (let index = 0; index < inputRoutes.length; index += 1) {
    expect(output[index]!.route[0]).toEqual(inputRoutes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(
      inputRoutes[index]!.route.at(-1),
    )
  }
})
