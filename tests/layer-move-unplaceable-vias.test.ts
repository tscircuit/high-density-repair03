import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import fixture from "./fixtures/repair-via-safety-before.json"

test("does not accept a layer move when its vias cannot be placed safely", () => {
  const srj: SimpleRouteJson = {
    ...(structuredClone(fixture.srj) as SimpleRouteJson),
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 6,
        height: 6,
        layers: ["bottom"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const input = structuredClone(fixture.inputRoutes)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: input,
    ...fixture.solverOptions,
  })
  solver.solve()

  const output = solver.getOutput()
  expect(solver.failed).toBe(false)
  expect(output).toEqual(input)
  expect(output.flatMap((route) => route.vias)).toHaveLength(0)
  const snapshot = getDrcSnapshot(
    srj,
    output,
    undefined,
    undefined,
    new AutoroutingDrcEngine(srj),
  )
  expect(snapshot.errors).toMatchObject([{ type: "pcb_trace_error" }])
})
