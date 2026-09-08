import { getMovingPointSegmentContact } from "./getMovingPointSegmentContact"

type Point = { x: number; y: number }

export type Rectangle = {
  center: Point
  halfWidth: number
  halfHeight: number
  cos: number
  sin: number
  circular?: boolean
}

const local = (point: Point, rectangle: Rectangle): Point => ({
  x: point.x * rectangle.cos + point.y * rectangle.sin,
  y: point.y * rectangle.cos - point.x * rectangle.sin,
})

export const getPointRectangleSignedDistance = (
  point: Point,
  rectangle: Rectangle,
): number => {
  const p = local(
    { x: point.x - rectangle.center.x, y: point.y - rectangle.center.y },
    rectangle,
  )
  if (rectangle.circular) return Math.hypot(p.x, p.y) - rectangle.halfWidth
  const dx = Math.abs(p.x) - rectangle.halfWidth
  const dy = Math.abs(p.y) - rectangle.halfHeight
  return (
    Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy))
  )
}

export const getMovingPointRectangleContact = (
  point: Point,
  movement: Point,
  rectangle: Rectangle,
  clearance: number,
): number => {
  const p = local(
    { x: point.x - rectangle.center.x, y: point.y - rectangle.center.y },
    rectangle,
  )
  const move = local(movement, rectangle)
  if (rectangle.circular) {
    const radius = rectangle.halfWidth + clearance
    if (radius <= 0) return Number.POSITIVE_INFINITY
    const zero = { x: 0, y: 0 }
    return getMovingPointSegmentContact(p, zero, zero, move, zero, zero, radius)
  }
  if (clearance <= 0) {
    const width = rectangle.halfWidth + clearance
    const height = rectangle.halfHeight + clearance
    if (width <= 0 || height <= 0) return Number.POSITIVE_INFINITY
    let enter = 0
    let exit = 1
    for (const [position, velocity, extent] of [
      [p.x, move.x, width],
      [p.y, move.y, height],
    ]) {
      if (velocity === 0) {
        if (Math.abs(position!) >= extent!) return Number.POSITIVE_INFINITY
        continue
      }
      const a = (-extent! - position!) / velocity!
      const b = (extent! - position!) / velocity!
      enter = Math.max(enter, Math.min(a, b))
      exit = Math.min(exit, Math.max(a, b))
    }
    return enter < exit ? enter : Number.POSITIVE_INFINITY
  }
  const corners = [
    { x: -rectangle.halfWidth, y: -rectangle.halfHeight },
    { x: rectangle.halfWidth, y: -rectangle.halfHeight },
    { x: rectangle.halfWidth, y: rectangle.halfHeight },
    { x: -rectangle.halfWidth, y: rectangle.halfHeight },
  ]
  const zero = { x: 0, y: 0 }
  return Math.min(
    ...corners.map((corner, index) =>
      getMovingPointSegmentContact(
        p,
        corner,
        corners[(index + 1) % 4]!,
        move,
        zero,
        zero,
        clearance,
      ),
    ),
  )
}
