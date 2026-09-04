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
  getNonViaPadDrcIssueCount,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import fixture from "./fixtures/repair-via-safety-before.json"

test("via placement completes trace clearance before a layer candidate is scored", () => {
  const srj = structuredClone(fixture.srj) as SimpleRouteJson
  const inputRoutes: HighDensityRoute[] = structuredClone(fixture.inputRoutes)
  for (const [index, obstacle] of srj.obstacles.entries()) {
    const horizontal = index < 4
    if (horizontal) obstacle.center.y = 0.2
    else obstacle.center.x = 0.2
    obstacle.connectedTo.push("guard")
    const name = `guard_${index}`
    srj.connections.push({
      name,
      rootConnectionName: "guard",
      pointsToConnect: [],
    })
    inputRoutes.push({
      connectionName: name,
      rootConnectionName: "guard",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-0.2, 0.2].map((offset) => ({
        x: obstacle.center.x + (horizontal ? offset : 0),
        y: obstacle.center.y + (horizontal ? 0 : offset),
        z: 0,
      })),
    })
  }

  const engine = new AutoroutingDrcEngine(srj)
  const evaluate = (routes: HighDensityRoute[]) =>
    getDrcSnapshot(srj, routes, undefined, undefined, engine)
  const input = evaluate(inputRoutes)
  expect(input.errors).toHaveLength(1)
  const candidate = cloneRoutes(inputRoutes)
  expect(
    applySafeTraceLayerMoveForError(srj, candidate, input.errors[0]!, 0, 1, 0),
  ).toBe(true)
  const incomplete = evaluate(materializeRoutes(candidate))
  // The layer swap removes the crossing, but its unplaced vias now contact
  // guard traces. Moving the vias away from the pads clears both error types.
  expect(getNonViaPadDrcIssueCount(incomplete)).toBeGreaterThanOrEqual(
    getNonViaPadDrcIssueCount(input),
  )
  expect(
    incomplete.errors.some((error) =>
      String(error.pcb_trace_error_id).includes("_via_"),
    ),
  ).toBe(true)

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
  expect(evaluate(output).errors).toEqual([])
  for (let index = 0; index < inputRoutes.length; index += 1) {
    expect(output[index]!.route[0]).toEqual(inputRoutes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(
      inputRoutes[index]!.route.at(-1),
    )
  }
})
