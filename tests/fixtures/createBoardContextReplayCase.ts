import type { SimpleRouteJson } from "../../lib/types"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

export const createBoardContextReplayCase = (caseIndex: number) => {
  let state = (0x1492e45a + caseIndex * 17) >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const scale = [1, 2, 5, 20][caseIndex % 4]!
  const offsetX = (random() - 0.5) * 20
  const offsetY = (random() - 0.5) * 20
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    defaultObstacleMargin: [0, 0.1, 0.3][caseIndex % 3],
    bounds: {
      minX: offsetX - 5 * scale,
      maxX: offsetX + 5 * scale,
      minY: offsetY - 4 * scale,
      maxY: offsetY + 4 * scale,
    },
    outline: [
      { x: offsetX - 4 * scale, y: offsetY - 3 * scale },
      { x: offsetX + 4 * scale, y: offsetY - 3 * scale },
      { x: offsetX + 4 * scale, y: offsetY + 3 * scale },
      { x: offsetX - 4 * scale, y: offsetY + 3 * scale },
    ],
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: offsetX, y: offsetY },
        width: 0.5 + random(),
        height: 0.5 + random(),
        layers: ["top", "bottom"],
        zLayers: [0, 1],
        connectedTo: [],
      },
    ],
  }
  if (caseIndex % 2) srj.outline!.reverse()
  if (caseIndex % 3 === 0) srj.outline!.push({ ...srj.outline![0]! })
  if (caseIndex % 11 === 0) srj.outline![1]!.y += 0.125
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 3; index++) {
    const nearEdge = caseIndex % 5 === 0
    const y = offsetY + (nearEdge ? 2.85 * scale : (index - 1) * 0.2)
    routes.push({
      connectionName: `route_${index}`,
      rootConnectionName: `route_${index}`,
      traceThickness: [0.1, 0.15, 0.3][index]!,
      viaDiameter: 0.3,
      route: [
        { x: offsetX - 3 * scale, y, z: 0 },
        { x: offsetX - 0.4, y: y + (random() - 0.5) * 0.1, z: 0 },
        { x: offsetX, y, z: 0 },
        { x: offsetX, y, z: 1 },
        { x: offsetX + 0.4, y: y + (random() - 0.5) * 0.1, z: 1 },
        { x: offsetX + 3 * scale, y, z: 1 },
      ],
      vias: [{ x: offsetX, y }],
    })
  }
  return { srj, routes, effort: 1, passMultiplier: 0.5 }
}

export const mutateBoardContextReplayInput = (
  srj: SimpleRouteJson,
  caseIndex: number,
) => {
  // Same owner object, different immutable scene for the next synchronous call.
  srj.outline = srj.outline!.map((point) => ({
    x: point.x,
    y: point.y * 0.5 + (caseIndex % 2 ? 0.2 : -0.2),
  }))
  srj.defaultObstacleMargin = (srj.defaultObstacleMargin ?? 0) + 0.05
}
