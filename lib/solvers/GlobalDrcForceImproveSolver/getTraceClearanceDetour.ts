import type { Point } from "./internalTypes"

/** Builds a dogleg outside the blocker's extent in the trace's local axes. */
export const getTraceClearanceDetour = (
  start: Point,
  end: Point,
  blocker: readonly Point[],
  clearance: number,
  direction: -1 | 1,
): Point[] | undefined => {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0 || blocker.length === 0 || clearance <= 0) return undefined
  const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }
  const normal = { x: -tangent.y, y: tangent.x }
  const projected = blocker.map((point) => ({
    t: (point.x - start.x) * tangent.x + (point.y - start.y) * tangent.y,
    n: (point.x - start.x) * normal.x + (point.y - start.y) * normal.y,
  }))
  const minT = Math.min(...projected.map((point) => point.t)) - clearance
  const maxT = Math.max(...projected.map((point) => point.t)) + clearance
  const minN = Math.min(...projected.map((point) => point.n)) - clearance
  const maxN = Math.max(...projected.map((point) => point.n)) + clearance
  if (maxT <= 0 || minT >= length || minN >= 0 || maxN <= 0) return undefined

  // A segment ending inside this conservative envelope needs a wider span or
  // a layer change. Moving or disconnecting that endpoint is not a repair.
  if (minT <= 0 || maxT >= length) return undefined
  const offset = direction === 1 ? maxN : minN
  const pointAt = (t: number, n: number): Point => ({
    x: start.x + tangent.x * t + normal.x * n,
    y: start.y + tangent.y * t + normal.y * n,
  })
  return [
    pointAt(minT, 0),
    pointAt(minT, offset),
    pointAt(maxT, offset),
    pointAt(maxT, 0),
  ]
}
