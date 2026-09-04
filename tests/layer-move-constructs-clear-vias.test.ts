import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import fixture from "./fixtures/repair-via-safety-before.json"

test("constructs pad-clear layer transitions before candidate DRC evaluation", () => {
  const srj = fixture.srj as SimpleRouteJson
  const inputRoutes: HighDensityRoute[] = structuredClone(fixture.inputRoutes)
  const engine = new AutoroutingDrcEngine(srj)
  const evaluate = (routes: HighDensityRoute[]) =>
    getDrcSnapshot(srj, routes, undefined, undefined, engine)
  const initial = evaluate(inputRoutes)
  expect(initial.errors).toMatchObject([{ type: "pcb_trace_error" }])

  // The constructor itself must produce legal via positions. No force
  // relaxation or DRC-driven retry runs between construction and this check.
  const candidateRoutes = cloneRoutes(inputRoutes)
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      candidateRoutes,
      initial.errors[0]!,
      0,
      1,
      0,
    ),
  ).toBe(true)
  const candidate = materializeRoutes(candidateRoutes)
  expect(evaluate(candidate).errors).toHaveLength(0)
  expect(candidate[0]!.vias).toHaveLength(2)
  for (const via of candidate[0]!.vias) {
    expect(via.y).toBeLessThan(-0.05)
  }

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    ...fixture.solverOptions,
  })
  solver.solve()
  const output = solver.getOutput()
  expect(solver.failed).toBe(false)
  expect(evaluate(output).errors).toHaveLength(0)
  expect(output.flatMap((route) => route.vias)).toHaveLength(2)
  for (let index = 0; index < inputRoutes.length; index += 1) {
    expect(output[index]!.route[0]).toEqual(inputRoutes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(
      inputRoutes[index]!.route.at(-1),
    )
  }
  expect(inputRoutes).toEqual(fixture.inputRoutes)
})
