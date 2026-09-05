import { expect, test } from "bun:test"
import { FinePitchPadEscapeSolver } from "../lib"
import { createTerminalViaEscapeRepro } from "../fixture-support/terminalViaEscapeRepro"

test("the terminal via escape search also repairs a route starting inside the BGA", () => {
  const repro = createTerminalViaEscapeRepro()
  const routes = structuredClone(repro.routes)
  routes[0]!.route.reverse()
  routes[0]!.vias.reverse()
  const solver = new FinePitchPadEscapeSolver({
    ...repro.solver.params,
    routes,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const result = solver.getOutput()
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
  expect(result.routes[0]!.vias).toHaveLength(2)
  expect(result.routes[0]!.vias).not.toEqual(routes[0]!.vias)
  expect(result.routes[1]).toEqual(routes[1])
})
