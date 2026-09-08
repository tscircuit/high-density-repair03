import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  obstacleSharesNet,
  sharesNet,
} from "../lib/solvers/GlobalDrcForceImproveSolver/netUtils"
import type { SimpleRouteJson } from "../lib/types"

test("net membership resolves aliases and observes connectivity changes", (): void => {
  const connMap = new ConnectivityMap({ alpha: ["a", "b", ""], beta: ["c"] })
  const cases: Array<[string, string | undefined, boolean]> = [
    ["a", "b", true],
    ["a", "c", false],
    ["alpha", "a", true],
    ["a", "alpha", true],
    ["alpha", "beta", false],
    ["unknown", "unknown", true],
    ["a", "unknown", false],
    ["a", undefined, false],
    ["a", "", false],
    ["", "a", true],
    ["", "alpha", false],
  ]
  for (const [left, right, connected] of cases) {
    expect(sharesNet(left, right, connMap)).toBe(connected)
  }
  const obstacle: SimpleRouteJson["obstacles"][number] = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: ["unrelated", "c", "beta"],
  }
  expect(obstacleSharesNet("a", obstacle, connMap)).toBe(false)
  connMap.addConnections([["b", "c"]])
  expect(sharesNet("a", "c", connMap)).toBe(true)
  expect(obstacleSharesNet("a", obstacle, connMap)).toBe(true)
  expect(obstacleSharesNet("alpha", obstacle, connMap)).toBe(true)
  expect(obstacleSharesNet("unrelated", obstacle)).toBe(true)
  expect(obstacleSharesNet("a", obstacle)).toBe(false)
})
