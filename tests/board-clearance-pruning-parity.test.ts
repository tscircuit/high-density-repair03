import { expect, test } from "bun:test"
import {
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import {
  getPointBoardClearance,
  getSegmentBoardClearance,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

type Point = { x: number; y: number }

test("board-edge pruning matches exhaustive distances for convex and concave outlines", (): void => {
  let seed = 529715
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (const edgeCount of [4, 12, 64]) {
    for (const concave of [false, true]) {
      const outline: Point[] = Array.from({ length: edgeCount }, (_, i) => {
        const angle = (2 * Math.PI * i) / edgeCount
        const radius = concave && i % 2 === 0 ? 5 : 10
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
      })
      const srj: SimpleRouteJson = {
        layerCount: 2,
        minTraceWidth: 0.15,
        bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
        obstacles: [],
        connections: [],
        outline,
      }
      for (let i = 0; i < 600; i++) {
        // The central square is inside every outline, including the concave
        // variants. Compare against every edge, without cache or pruning.
        const start = { x: random() * 4 - 2, y: random() * 4 - 2 }
        const end = { x: random() * 4 - 2, y: random() * 4 - 2 }
        let pointDistance = Number.POSITIVE_INFINITY
        let segmentDistance = Number.POSITIVE_INFINITY
        for (let edge = 0; edge < outline.length; edge++) {
          const a = outline[edge]!
          const b = outline[(edge + 1) % outline.length]!
          pointDistance = Math.min(
            pointDistance,
            pointToSegmentDistance(start, a, b),
          )
          segmentDistance = Math.min(
            segmentDistance,
            segmentToSegmentMinDistance(start, end, a, b),
          )
        }
        expect(getPointBoardClearance(srj, start)).toBe(pointDistance)
        expect(getSegmentBoardClearance(srj, start, end)).toBe(segmentDistance)
        if (i % 100 === 99) outline.reverse()
      }
    }
  }
  const outline: Point[] = [
    { x: -5, y: -5 },
    { x: 5, y: -5 },
    { x: 5, y: 5 },
    { x: -5, y: 5 },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    connections: [],
    outline,
  }
  for (const distance of [0, 1e-12, 1e-9, 1e-6, 0.000999, 0.001001]) {
    const start = { x: -5 + distance, y: -5 + distance }
    const end = { x: 5 - distance, y: 5 - distance }
    const distances = outline.map((edge, i) => ({
      point: pointToSegmentDistance(start, edge, outline[(i + 1) % 4]!),
      segment: segmentToSegmentMinDistance(
        start,
        end,
        edge,
        outline[(i + 1) % 4]!,
      ),
    }))
    expect(getPointBoardClearance(srj, start)).toBe(
      Math.min(...distances.map((d) => d.point)),
    )
    expect(getSegmentBoardClearance(srj, start, end)).toBe(
      Math.min(...distances.map((d) => d.segment)),
    )
  }
})
