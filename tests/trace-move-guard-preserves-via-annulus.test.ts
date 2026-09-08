import { expect, test } from "bun:test"
import { TraceSegmentMoveGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceSegmentMoveGuard"

test("force movement preserves via annulus clearance including swept contact", (): void => {
  const viaPoint = { x: 0, y: 0.29 }
  const via = {
    start: viaPoint,
    end: viaPoint,
    z: 1,
    traceRadius: 0.15,
    clearance: 0.1,
    rootConnectionName: "via",
  }
  const trace = {
    start: { x: -0.5, y: 0 },
    end: { x: 0.5, y: 0 },
    z: 1,
    traceRadius: 0.05,
    rootConnectionName: "trace",
  }
  const guard = new TraceSegmentMoveGuard([via, trace])
  const blocked = guard.constrain([viaPoint], 0, -1)
  expect(blocked.y).toBeGreaterThanOrEqual(-0.000002)
  const opening = guard.constrain([viaPoint], 0, 0.5)
  expect(opening).toEqual({ x: 0, y: 0.5 })
  viaPoint.y += opening.y
  const closing = guard.constrain([trace.start, trace.end], 0, 1)
  expect(closing.y).toBeGreaterThan(0.49)
  expect(closing.y).toBeLessThanOrEqual(0.500002)

  const grazingPoint = { x: -1, y: 0.299 }
  const grazingVia = { ...via, start: grazingPoint, end: grazingPoint }
  const shortTrace = { ...trace, start: { x: 0, y: 0 }, end: { x: 0.01, y: 0 } }
  const grazingGuard = new TraceSegmentMoveGuard([grazingVia, shortTrace])
  const grazingMove = grazingGuard.constrain([grazingPoint], 2, 0)
  expect(grazingMove.x).toBeGreaterThan(0.97)
  expect(grazingMove.x).toBeLessThan(1)

  const sameNetGuard = new TraceSegmentMoveGuard([
    via,
    { ...trace, rootConnectionName: "via" },
  ])
  expect(sameNetGuard.constrain([viaPoint], 0, -1)).toEqual({ x: 0, y: -1 })
})
