type Point = { x: number; y: number }

const roots = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) < 1e-20) return Math.abs(b) < 1e-20 ? [] : [-c / b]
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant))
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q]
}

/**
 * First contact with a moving capsule. Velocities are either zero or the same
 * translation, so the signed line distance has a linear numerator. Endpoint
 * circles and the interior strip cover the capsule, including grazing moves
 * whose final position is clear.
 */
export const getMovingPointSegmentContact = (
  point: Point,
  start: Point,
  end: Point,
  pointMove: Point,
  startMove: Point,
  endMove: Point,
  radius: number,
): number => {
  let firstContact = Number.POSITIVE_INFINITY
  const test = (t: number): boolean =>
    t > 1e-12 && t <= Math.min(1, firstContact)
  for (const [endpoint, movement] of [
    [start, startMove],
    [end, endMove],
  ]) {
    const x = point.x - endpoint!.x
    const y = point.y - endpoint!.y
    const dx = pointMove.x - movement!.x
    const dy = pointMove.y - movement!.y
    for (const t of roots(
      dx * dx + dy * dy,
      2 * (x * dx + y * dy),
      x * x + y * y - radius * radius,
    )) {
      if (test(t) && (x + dx * t) * dx + (y + dy * t) * dy < 0) firstContact = t
    }
  }
  const ex = end.x - start.x
  const ey = end.y - start.y
  const dex = endMove.x - startMove.x
  const dey = endMove.y - startMove.y
  const px = point.x - start.x
  const py = point.y - start.y
  const dpx = pointMove.x - startMove.x
  const dpy = pointMove.y - startMove.y
  const cross0 = ex * py - ey * px
  const cross1 = dex * py - dey * px + ex * dpy - ey * dpx
  const a = cross1 * cross1 - radius * radius * (dex * dex + dey * dey)
  const b = 2 * (cross0 * cross1 - radius * radius * (ex * dex + ey * dey))
  const c = cross0 * cross0 - radius * radius * (ex * ex + ey * ey)
  for (const t of roots(a, b, c)) {
    if (!test(t) || 2 * a * t + b >= 0) continue
    const edgeX = ex + dex * t
    const edgeY = ey + dey * t
    const lengthSquared = edgeX * edgeX + edgeY * edgeY
    const dot = (px + dpx * t) * edgeX + (py + dpy * t) * edgeY
    if (lengthSquared > 0 && dot >= 0 && dot <= lengthSquared) firstContact = t
  }
  return firstContact
}
