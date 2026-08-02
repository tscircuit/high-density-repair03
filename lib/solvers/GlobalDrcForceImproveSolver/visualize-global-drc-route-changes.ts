import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "../../types/high-density-types"

const getLayerColor = (z: number, opacity: number) =>
  z === 0 ? `rgba(220, 38, 38, ${opacity})` : `rgba(37, 99, 235, ${opacity})`

const addRouteFrame = ({
  graphics,
  routes,
  step,
  isOutput,
}: {
  graphics: Required<Pick<GraphicsObject, "lines" | "circles" | "points">>
  routes: HighDensityRoute[]
  step: number
  isOutput: boolean
}) => {
  for (const route of routes) {
    for (
      let pointIndex = 0;
      pointIndex < route.route.length - 1;
      pointIndex++
    ) {
      const start = route.route[pointIndex]!
      const end = route.route[pointIndex + 1]!
      if (start.z !== end.z) continue
      graphics.lines.push({
        points: [start, end],
        strokeColor: getLayerColor(start.z, isOutput ? 0.9 : 0.35),
        strokeWidth: route.traceThickness,
        label: `${isOutput ? "after" : "before"}: ${route.connectionName} z=${start.z}`,
        step,
      })
    }

    for (const via of route.vias) {
      graphics.circles.push({
        center: via,
        radius: route.viaDiameter / 2,
        fill: isOutput ? "rgba(22, 163, 74, 0.65)" : "rgba(245, 158, 11, 0.45)",
        stroke: isOutput ? "#15803d" : "#b45309",
        label: `${isOutput ? "after" : "before"}: ${route.connectionName} via`,
        step,
      })
    }
  }
}

/** Shows the routed copper before and after accepted exact-geometry repairs. */
export const visualizeGlobalDrcRouteChanges = ({
  inputHdRoutes,
  outputHdRoutes,
}: {
  inputHdRoutes: HighDensityRoute[]
  outputHdRoutes: HighDensityRoute[]
}): GraphicsObject => {
  const graphics: GraphicsObject &
    Required<Pick<GraphicsObject, "lines" | "circles" | "points">> = {
    coordinateSystem: "cartesian",
    title: "Global DRC Force Improve Solver: before / after",
    lines: [],
    circles: [],
    points: [],
  }

  addRouteFrame({ graphics, routes: inputHdRoutes, step: 1, isOutput: false })
  addRouteFrame({ graphics, routes: outputHdRoutes, step: 2, isOutput: true })

  for (let routeIndex = 0; routeIndex < inputHdRoutes.length; routeIndex++) {
    const inputRoute = inputHdRoutes[routeIndex]
    const outputRoute = outputHdRoutes[routeIndex]
    if (!inputRoute || !outputRoute) continue
    for (let viaIndex = 0; viaIndex < inputRoute.vias.length; viaIndex++) {
      const inputVia = inputRoute.vias[viaIndex]
      const outputVia = outputRoute.vias[viaIndex]
      if (!inputVia || !outputVia) continue
      if (inputVia.x === outputVia.x && inputVia.y === outputVia.y) continue
      graphics.lines.push({
        points: [inputVia, outputVia],
        strokeColor: "#7c3aed",
        strokeWidth: 0.03,
        strokeDash: [0.04, 0.03],
        label: `${outputRoute.connectionName}: accepted via move`,
        step: 2,
      })
    }
  }

  return graphics
}
