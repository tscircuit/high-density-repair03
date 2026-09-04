import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("external via placement does not require electrical clearance from its own-net pad", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 2, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.64,
        layers: ["top"],
        connectedTo: ["own-net", "pcb_smtpad_own", "pcb_port_own"],
      },
      {
        type: "rect",
        center: { x: 0, y: 0.87 },
        width: 0.7,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["pad-net", "pcb_smtpad_foreign"],
      },
    ],
    connections: [
      { name: "own-net", pointsToConnect: [] },
      { name: "neighbor-net", pointsToConnect: [] },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "own-net",
      rootConnectionName: "own-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_own" },
        { x: -0.44, y: 0.44, z: 0 },
        { x: -0.44, y: 0.44, z: 1 },
        { x: -1.5, y: 1.7, z: 1 },
      ],
      vias: [{ x: -0.44, y: 0.44 }],
    },
    {
      connectionName: "neighbor-net",
      rootConnectionName: "neighbor-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.8, y: -0.2, z: 0 },
        { x: -0.8, y: 1.4, z: 0 },
      ],
      vias: [],
    },
  ]
  const input = structuredClone(routes)
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })
  const before = getDrcSnapshot(srj, routes, undefined, undefined, engine)
  expect(before.errors).toHaveLength(1)
  expect(before.errors[0]?.type).toBe("pcb_pad_pad_clearance_error")

  // Adding foreign-net clearance around the own-net pad pushes the via
  // into the neighboring trace. Only its copper radius must clear this pad.
  const output = applyViaToPadClearanceRelaxation(srj, routes, undefined, 0)
  const after = getDrcSnapshot(srj, output, undefined, undefined, engine)
  expect(after.errors).toHaveLength(0)
  expect(after.count).toBe(0)

  const via = output[0]!.vias[0]!
  const radius = output[0]!.viaDiameter / 2
  const distanceToOwnPad = Math.hypot(
    Math.max(Math.abs(via.x) - 0.35, 0),
    Math.max(Math.abs(via.y) - 0.32, 0),
  )
  const distanceToForeignPad = Math.hypot(
    Math.max(Math.abs(via.x) - 0.35, 0),
    Math.max(Math.abs(via.y - 0.87) - 0.25, 0),
  )
  expect(distanceToOwnPad).toBeGreaterThanOrEqual(radius)
  expect(distanceToForeignPad - radius).toBeGreaterThanOrEqual(0.1)
  expect(Math.abs(via.x + 0.8) - radius - 0.05).toBeGreaterThanOrEqual(0.1)
  expect(output[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(output[1]).toEqual(input[1])
  expect(routes).toEqual(input)
})
