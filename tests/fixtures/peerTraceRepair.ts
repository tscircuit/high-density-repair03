import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute, SimpleRouteJson } from "../../lib"

type ContactPair = string

/** Independently generated, then reduced to four routes and decimal coordinates. */
export const createPeerTraceRepairInput = (): {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
} => {
  const hdRoutes: HighDensityRoute[] = [
    [0.2, 0.4],
    [0.4, 0.3],
    [0.6, 0.4],
    [0.8, 0.5],
  ].map(([terminalY, bendY], index) => ({
    connectionName: `signal_${index + 1}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: terminalY!, z: 0 },
      { x: 2, y: bendY!, z: 0 },
      { x: 3, y: terminalY!, z: 0 },
    ],
  }))
  return {
    hdRoutes,
    srj: {
      bounds: { minX: -1, minY: -1, maxX: 4, maxY: 2 },
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      obstacles: [],
      connections: hdRoutes.map(({ connectionName }) => ({
        name: connectionName,
        pointsToConnect: [],
      })),
    },
  }
}

/** Exhaustive geometric oracle for fixtures whose routes are on distinct nets. */
export const getPhysicalPeerPairs = (
  routes: HighDensityRoute[],
): ContactPair[] => {
  const pairs = new Set<ContactPair>()
  for (let a = 0; a < routes.length; a++) {
    for (let b = a + 1; b < routes.length; b++) {
      const left = routes[a]!
      const right = routes[b]!
      for (let i = 1; i < left.route.length; i++) {
        for (let j = 1; j < right.route.length; j++) {
          const startA = left.route[i - 1]!
          const endA = left.route[i]!
          const startB = right.route[j - 1]!
          const endB = right.route[j]!
          if (
            startA.z !== endA.z ||
            startB.z !== endB.z ||
            startA.z !== startB.z ||
            startA.toNextSegmentType === "through_obstacle" ||
            startB.toNextSegmentType === "through_obstacle"
          ) {
            continue
          }
          const copperGap =
            segmentToSegmentMinDistance(startA, endA, startB, endB) -
            (left.traceThickness + right.traceThickness) / 2
          if (copperGap < -1e-9) {
            pairs.add(
              JSON.stringify(
                [left.connectionName, right.connectionName].sort(),
              ),
            )
          }
        }
      }
    }
  }
  return [...pairs].sort()
}
