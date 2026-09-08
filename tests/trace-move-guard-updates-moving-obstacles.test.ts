import { expect, test } from "bun:test"
import { TraceSegmentMoveGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceSegmentMoveGuard"

test("later force moves see an obstacle in its updated spatial cell", (): void => {
  const obstacle = {
    start: { x: 0, y: -1 },
    end: { x: 0, y: 1 },
    z: 0,
    traceRadius: 0.05,
    rootConnectionName: "obstacle",
  }
  const moving = {
    start: { x: 11, y: 0 },
    end: { x: 11.5, y: 0 },
    z: 0,
    traceRadius: 0.05,
    rootConnectionName: "moving",
  }
  const guard = new TraceSegmentMoveGuard([obstacle, moving])
  const firstMove = guard.constrain([obstacle.start, obstacle.end], 10, 0)
  expect(firstMove).toEqual({ x: 10, y: 0 })
  obstacle.start.x += firstMove.x
  obstacle.end.x += firstMove.x

  const nextMove = guard.constrain([moving.start, moving.end], -2, 0)
  expect(nextMove.x).toBeGreaterThanOrEqual(-0.900002)
  expect(nextMove.x).toBeLessThan(-0.89)
  expect(nextMove.y).toBe(0)
  expect(moving.start.x + nextMove.x).toBeGreaterThan(obstacle.start.x)
})
