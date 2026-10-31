import type { Circle, GraphicsObject, Line } from "graphics-debug"
import type { HighDensityRoute } from "../../lib"

/** Top-layer copper of the two nets involved in the regression, at actual widths. */
export const getTraceViaShortGraphics = (
  routes: HighDensityRoute[],
): GraphicsObject => {
  const lines: Line[] = []
  const circles: Circle[] = []
  for (const route of routes) {
    if (route.connectionName !== "n2" && route.connectionName !== "n3") continue
    const color = route.connectionName === "n2" ? "#2563eb" : "#9333ea"
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== 0 || end.z !== 0) continue
      lines.push({
        points: [start, end],
        strokeWidth: route.traceThickness,
        strokeColor: color,
        label: `${route.connectionName} top trace`,
      })
    }
    for (const via of route.vias) {
      circles.push({
        center: via,
        radius: route.viaDiameter / 2,
        fill: color,
        label: `${route.connectionName} through via`,
      })
    }
  }
  return { coordinateSystem: "cartesian", lines, circles }
}
