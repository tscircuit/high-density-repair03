import { expect, test } from "bun:test"
import { getPointToObstacleDistance } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { Obstacle } from "../lib/types"

test("measures circular BGA pad clearance without blocking the square corners", () => {
  // OrangeCrab's ECP5 uses 0.23 mm balls on a 0.5 mm pitch. A 0.28 mm
  // via at the four-ball midpoint fits the actual circles with 0.089 mm clearance.
  const pad: Obstacle = {
    type: "rect",
    shape: "circle",
    center: { x: 0, y: 0 },
    width: 0.23,
    height: 0.23,
    layers: ["top"],
    connectedTo: ["pad"],
  }
  const midpoint = { x: 0.25, y: 0.25 }
  expect(getPointToObstacleDistance(midpoint, pad)).toBeCloseTo(
    0.23855339059327377,
    12,
  )
  expect(getPointToObstacleDistance(midpoint, pad) - 0.14).toBeGreaterThan(
    0.089,
  )
  expect(getPointToObstacleDistance(pad.center, pad)).toBe(0)
  expect(getPointToObstacleDistance({ x: 0.115, y: 0 }, pad)).toBe(0)
  expect(
    getPointToObstacleDistance(midpoint, { ...pad, shape: undefined }),
  ).toBeCloseTo(0.19091883092036782, 12)
})
