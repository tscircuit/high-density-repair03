import type { GraphicsObject, Line } from "graphics-debug"
import type { HighDensityRoute } from "../../lib"
import provenance from "./existing-pad-overlap-input.provenance.json"

/** Local top-layer segments at their real widths; other copper is omitted. */
export const getExistingPadOverlapGraphics = (
  routes: HighDensityRoute[],
): GraphicsObject => {
  const { physicalPad, routingObstacle } = provenance
  const lines: Line[] = []
  for (const route of routes) {
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== 0 || end.z !== 0) continue
      if (
        [start, end].some(
          (point) =>
            Math.abs(point.x - physicalPad.center.x) > 1.5 ||
            Math.abs(point.y - physicalPad.center.y) > 1.5,
        )
      )
        continue
      lines.push({
        points: [start, end],
        strokeWidth: route.traceThickness,
        strokeColor: "#dc2626",
      })
    }
  }
  return {
    coordinateSystem: "cartesian",
    rects: [
      {
        center: physicalPad.center,
        width: routingObstacle.width,
        height: routingObstacle.height,
        fill: "#94a3b820",
        stroke: "#64748b",
        label: "Expanded routing obstacle",
      },
      {
        center: physicalPad.center,
        width: physicalPad.width,
        height: physicalPad.height,
        fill: "#fbbf2460",
        stroke: "#a16207",
        label: "Actual pad copper",
      },
    ],
    lines,
  }
}
