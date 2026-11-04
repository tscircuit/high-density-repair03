import { expect, test } from "bun:test"
import { getRectRepulsion } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { Obstacle } from "../lib/types"

test("keeps a via in a legal BGA diagonal gap and repels actual circular-pad violations", () => {
  const pad: Obstacle = {
    type: "rect",
    shape: "circle",
    center: { x: 0, y: 0 },
    width: 0.23,
    height: 0.23,
    layers: ["top"],
    connectedTo: ["pad"],
  }
  const requiredDistance = 0.14 + 0.089
  expect(
    getRectRepulsion({ x: 0.25, y: 0.25 }, pad, requiredDistance),
  ).toBeUndefined()
  const overlap = getRectRepulsion({ x: 0.24, y: 0.24 }, pad, requiredDistance)!
  expect(overlap.penetration).toBeCloseTo(0.004588745030457197, 12)
  expect(overlap.direction.x).toBeCloseTo(Math.SQRT1_2, 12)
  expect(overlap.direction.y).toBeCloseTo(Math.SQRT1_2, 12)
  const centered = getRectRepulsion(pad.center, pad, requiredDistance)!
  expect(centered.direction).toEqual({ x: 1, y: 0 })
  expect(centered.penetration).toBeCloseTo(0.344, 12)
  const square = getRectRepulsion(
    { x: 0.25, y: 0.25 },
    { ...pad, shape: undefined },
    requiredDistance,
  )!
  expect(square.penetration).toBeCloseTo(0.03808116907963219, 12)
})
