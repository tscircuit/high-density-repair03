import { expect, test } from "bun:test"
import { createTerminalViaEscapeRepro } from "../fixture-support/terminalViaEscapeRepro"

test("a narrow BGA escape relocates an existing via without moving terminals or fixed copper", () => {
  const { routes, solver } = createTerminalViaEscapeRepro()
  const input = structuredClone(routes)
  solver.solve()
  expect(solver.failed).toBe(false)
  const result = solver.getOutput()
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.routes[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(result.routes[0]!.vias).toHaveLength(2)
  expect(result.routes[0]!.vias).not.toEqual(input[0]!.vias)
  expect(result.routes[1]).toEqual(input[1])
  expect(routes).toEqual(input)
})
