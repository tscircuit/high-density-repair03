import type { GraphicsObject, Line } from "graphics-debug"
import type { HighDensityRoute } from "../../lib"

const routeColors = [
  "rgba(37, 99, 235, 0.42)",
  "rgba(220, 38, 38, 0.42)",
  "rgba(5, 150, 105, 0.42)",
  "rgba(124, 58, 237, 0.42)",
  "rgba(217, 119, 6, 0.42)",
  "rgba(8, 145, 178, 0.42)",
]

// The display fixture contains clipped same-layer segments and explicit vias.
export const getSavedCopperGraphics = (
  routes: HighDensityRoute[],
): GraphicsObject => ({
  lines: routes.flatMap((route, routeIndex) => {
    const lines: Line[] = []
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== end.z) continue
      lines.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: routeColors[start.z % routeColors.length]!,
        strokeWidth: Math.max(route.traceThickness, 0.04),
        label: `${route.connectionName} z${start.z}`,
        zIndex: -100 + routeIndex,
      })
    }
    return lines
  }),
  circles: routes.flatMap((route) =>
    route.vias.map((via) => ({
      center: { x: via.x, y: via.y },
      radius: (route.viaDiameter || 0.3) / 2,
      fill: "rgba(17, 24, 39, 0.5)",
      stroke: "rgba(248, 250, 252, 0.5)",
      label: `${route.connectionName} via`,
    })),
  ),
})
