import { expect, test } from "bun:test"
import {
  getPointBoardClearance,
  getPointBoardInwardNormal,
  getSegmentBoardClearance,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

type Point = { x: number; y: number }

const expectFreshGeometry = (srj: SimpleRouteJson, points: Point[]): void => {
  for (const point of points) {
    // New board and point identities bypass all cached results, while retaining
    // the original boundary predicates and floating-point distance functions.
    const fresh = structuredClone(srj)
    expect(getPointBoardClearance(srj, point)).toBe(
      getPointBoardClearance(fresh, { ...point }),
    )
    expect(getPointBoardInwardNormal(srj, point)).toEqual(
      getPointBoardInwardNormal(fresh, { ...point }),
    )
  }
  for (let i = 1; i < points.length; i++) {
    expect(getSegmentBoardClearance(srj, points[i - 1]!, points[i]!)).toBe(
      getSegmentBoardClearance(
        structuredClone(srj),
        { ...points[i - 1]! },
        { ...points[i]! },
      ),
    )
  }
}

test("board clearances invalidate cached points, segments, bounds and in-place outline changes", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    connections: [],
  }
  const points: Point[] = [
    { x: -4, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
    { x: 0, y: 0 },
  ]
  expect(getPointBoardClearance(srj, points[0]!)).toBe(1)
  expect(getSegmentBoardClearance(srj, points[0]!, points[1]!)).toBe(1)
  expect(getPointBoardInwardNormal(srj, points[0]!)).toEqual({ x: 1, y: 0 })
  for (let pass = 0; pass < 12; pass++) {
    expectFreshGeometry(srj, points)
    points[0]!.x += 0.1
    points[1]!.y -= 0.2
    srj.bounds.minX -= 0.05
    expectFreshGeometry(srj, points)
    srj.outline = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ]
    expectFreshGeometry(srj, points)
    // Convert the same array to a concave outline, then move its vertices.
    srj.outline.splice(2, 0, { x: 0, y: 0 })
    expectFreshGeometry(srj, points)
    srj.outline[2]!.x = -2 + pass * 0.1
    srj.outline[2]!.y = 1
    expectFreshGeometry(srj, points)
    srj.outline.reverse()
    points[2]!.x = -0
    expectFreshGeometry(srj, points)
    points[2]!.x = 0
    srj.outline.length = 2
    expectFreshGeometry(srj, points)
    srj.outline = undefined
    expectFreshGeometry(srj, points)
  }
})
