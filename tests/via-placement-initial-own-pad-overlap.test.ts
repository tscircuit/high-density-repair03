import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("an initially overlapping external via can move outward clear of its own pad", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "own-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.7,
        layers: ["top"],
        connectedTo: ["own-net", "pcb_smtpad_own"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "own-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_own" },
        { x: 0.45, y: 0, z: 0 },
        { x: 0.45, y: 0, z: 1 },
        { x: -1, y: 1, z: 1 },
      ],
      vias: [{ x: 0.45, y: 0 }],
    },
  ]
  const input = structuredClone(routes)
  const output = applyViaToPadClearanceRelaxation(srj, routes, undefined, 0)
  const via = output[0]!.vias[0]!
  expect(via.x).toBeGreaterThan(input[0]!.vias[0]!.x)
  expect(via.x - 0.35).toBeGreaterThanOrEqual(output[0]!.viaDiameter / 2)
  expect(output[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(routes).toEqual(input)
})
