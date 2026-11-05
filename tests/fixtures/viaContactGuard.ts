import type { HighDensityRoute, SimpleRouteJson } from "../../lib"

export const createViaContactGuardInput = (): {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
} => {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "via",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 1, z: 1 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 1, z: 2 },
        { x: 1, y: 1, z: 2 },
      ],
      vias: [{ x: 0, y: 1 }],
    },
  ]
  return {
    hdRoutes,
    srj: {
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 12 },
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      obstacles: [],
      connections: hdRoutes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [],
      })),
    },
  }
}
