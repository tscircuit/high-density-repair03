import { expect, test } from "bun:test"
import { TraceSegmentMoveGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceSegmentMoveGuard"

test("movement precision never reduces the required copper separation", (): void => {
  for (const offset of [0, 17.125]) {
    for (const initialDistance of [0.3, 0.1]) {
      const start = { x: offset + initialDistance, y: -0.5 }
      const end = { x: offset + initialDistance, y: 0.5 }
      const minimum = Math.min(initialDistance, 0.075 + 0.05)
      const guard = new TraceSegmentMoveGuard([
        {
          start,
          end,
          z: 0,
          traceRadius: 0.075,
          rootConnectionName: "moving",
        },
        {
          start: { x: offset, y: -1 },
          end: { x: offset, y: 1 },
          z: 0,
          traceRadius: 0.05,
          rootConnectionName: "fixed",
        },
      ])
      for (let iteration = 0; iteration < 3; iteration++) {
        const move = guard.constrain([start, end], -0.3, 0)
        start.x += move.x
        start.y += move.y
        end.x += move.x
        end.y += move.y
        expect(start.x - offset).toBeGreaterThanOrEqual(minimum - 1e-14)
        expect(end.x - offset).toBeGreaterThanOrEqual(minimum - 1e-14)
      }
      expect(start.x - offset).toBeLessThan(initialDistance + 1e-14)
    }
  }
})
