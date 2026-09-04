import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  getDrcSnapshot,
  getPointToObstacleDistance,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("an unchanged own-pad edge overlap does not veto another via's repair", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
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
      {
        type: "rect",
        center: { x: 1.4, y: 0.2 },
        width: 0.1,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "own-net",
      rootConnectionName: "own-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.45, y: 0, z: 0, pcb_port_id: "pcb_port_own" },
        { x: 0.45, y: 0, z: 1 },
        { x: 1.4, y: 0, z: 1 },
        { x: 1.4, y: 0, z: 0 },
        { x: 2, y: -1, z: 0 },
      ],
      vias: [{ x: 0.45, y: 0 }, { x: 1.4, y: 0 }],
    },
  ]
  const input = structuredClone(routes)
  const ownPad = srj.obstacles[0]!
  const foreignPad = srj.obstacles[1]!
  const radius = routes[0]!.viaDiameter / 2
  const originalOwnDistance = getPointToObstacleDistance(
    routes[0]!.vias[0]!,
    ownPad,
  )
  expect(originalOwnDistance).toBeCloseTo(0.1, 6)
  expect(originalOwnDistance).toBeLessThan(radius)
  expect(
    getPointToObstacleDistance(routes[0]!.vias[1]!, foreignPad) - radius,
  ).toBeLessThan(0.1)

  const output = applyViaToPadClearanceRelaxation(srj, routes, undefined, 0)
  expect(output[0]!.vias).toHaveLength(2)
  expect(output[0]!.vias[0]).toEqual(input[0]!.vias[0])
  expect(output[0]!.route.slice(0, 2)).toEqual(input[0]!.route.slice(0, 2))
  expect(output[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(
    getPointToObstacleDistance(output[0]!.vias[0]!, ownPad),
  ).toBeGreaterThanOrEqual(originalOwnDistance)
  // This via is independently movable. Its improvement must not be rolled
  // back because the fixed endpoint's pre-existing overlap remains unchanged.
  expect(
    getPointToObstacleDistance(output[0]!.vias[1]!, foreignPad) - radius,
  ).toBeGreaterThanOrEqual(0.1)
  expect(
    getDrcSnapshot(
      srj,
      output,
      undefined,
      undefined,
      new AutoroutingDrcEngine(srj),
    ).errors,
  ).toEqual([])
  expect(routes).toEqual(input)
})
