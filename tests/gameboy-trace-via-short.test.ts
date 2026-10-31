import { beforeAll, expect, test } from "bun:test"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  getGameBoyContactRepair,
  getGameBoyTraceViaContact,
} from "./fixtures/gameBoyContactRepair"

beforeAll(() => {
  const { input, original, connMap, solver, output } = getGameBoyContactRepair()
  expect(input.hdRoutes).toHaveLength(119)
  expect(input.srj.obstacles).toHaveLength(378)
  expect(getGameBoyTraceViaContact(input.inputHdRoutes).gap).toBeGreaterThan(
    0.08,
  )
  expect(getGameBoyTraceViaContact(input.hdRoutes).gap).toBeLessThan(-0.1)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(input).toEqual(original)
  expect(output).toHaveLength(input.inputHdRoutes.length)
  expect(
    getDrcSnapshot(input.srj, output, undefined, connMap).count,
  ).toBeLessThanOrEqual(
    getDrcSnapshot(input.srj, input.inputHdRoutes, undefined, connMap).count,
  )
  for (let index = 0; index < output.length; index++) {
    expect(output[index]!.route[0]).toEqual(
      input.inputHdRoutes[index]!.route[0],
    )
    expect(output[index]!.route.at(-1)).toEqual(
      input.inputHdRoutes[index]!.route.at(-1),
    )
  }
})

test("Game Boy repair does not publish a new trace-to-via short", () => {
  expect(
    getGameBoyTraceViaContact(getGameBoyContactRepair().output).gap,
  ).toBeGreaterThanOrEqual(-1e-9)
})
