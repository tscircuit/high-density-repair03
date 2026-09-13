import { expect, test } from "bun:test"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("broad pad repulsion uses each via's actual copper diameter", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.5 },
        width: 0.8,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
      },
    ],
    connections: [],
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "large-via",
      traceThickness: 0.1,
      viaDiameter: 0.8,
      route: [
        { x: -2, y: 2, z: 0 },
        { x: 0, y: 0.45, z: 0 },
        { x: 0, y: 0.45, z: 1 },
        { x: 2, y: 2, z: 1 },
      ],
      vias: [{ x: 0, y: 0.45 }],
    },
  ]
  const original = structuredClone(input)
  const [output] = applyBroadRepulsionForces(srj, input, 1)
  expect(output!.route[1]!.y - output!.viaDiameter / 2).toBeGreaterThanOrEqual(
    0.1,
  )
  expect(output!.route[1]!.x).toBe(output!.route[2]!.x)
  expect(output!.route[1]!.y).toBe(output!.route[2]!.y)
  expect(output!.viaDiameter).toBe(0.8)
  expect(output!.traceThickness).toBe(0.1)
  expect(output!.route[0]).toEqual(input[0]!.route[0])
  expect(output!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(input).toEqual(original)
})
