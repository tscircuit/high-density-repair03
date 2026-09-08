import { expect, test } from "bun:test"
import { TraceSegmentMoveGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceSegmentMoveGuard"

test("via movement preserves pad copper and existing signed penetration", (): void => {
  const point = { x: 1, y: 0 }
  const via = {
    start: point,
    end: point,
    pointAliases: [point],
    z: 0,
    traceRadius: 0.15,
    clearance: 0.1,
    rootConnectionName: "via-net",
  }
  const pad = {
    start: { x: -0.5, y: -0.5 },
    end: { x: 0.5, y: 0.5 },
    z: 0,
    traceRadius: 0,
    clearance: 0.1,
    rootConnectionName: "",
    rectangle: {
      center: { x: 0, y: 0 },
      halfWidth: 0.5,
      halfHeight: 0.5,
      cos: 1,
      sin: 0,
    },
  }
  const foreignGuard = new TraceSegmentMoveGuard([via, pad])
  const foreignMove = foreignGuard.constrain([point], -2, 0)
  expect(foreignMove.x).toBeGreaterThanOrEqual(-0.250002)
  expect(foreignMove.x).toBeLessThan(-0.249)

  const sameNetGuard = new TraceSegmentMoveGuard([
    via,
    { ...pad, sameNetRoots: new Set(["via-net"]) },
  ])
  const sameNetMove = sameNetGuard.constrain([point], -2, 0)
  expect(sameNetMove.x).toBeGreaterThanOrEqual(-0.350002)
  expect(sameNetMove.x).toBeLessThan(-0.349)

  const inside = { x: 0.1, y: 0 }
  const insideGuard = new TraceSegmentMoveGuard([
    { ...via, start: inside, end: inside, pointAliases: [inside] },
    pad,
  ])
  expect(insideGuard.constrain([inside], -1, 0).x).toBeGreaterThanOrEqual(
    -0.000002,
  )
  expect(insideGuard.constrain([inside], 1, 0)).toEqual({ x: 1, y: 0 })

  const grazing = { x: 0.6, y: 0.6 }
  const circularGuard = new TraceSegmentMoveGuard([
    { ...via, start: grazing, end: grazing, pointAliases: [grazing] },
    { ...pad, rectangle: { ...pad.rectangle, circular: true } },
  ])
  const circularMove = circularGuard.constrain([grazing], -1.2, 0)
  expect(circularMove.x).toBeGreaterThanOrEqual(-0.15001)
  expect(circularMove.x).toBeLessThan(-0.149)
})
