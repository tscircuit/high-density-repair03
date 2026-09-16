import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import {
  applyDrcErrorForces,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("local pad repair moves the colliding segment before its neighboring bend", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0.5, z: 0, pcb_port_id: "start" },
      { x: -1, y: 0.12, z: 0 },
      { x: 1, y: 0.12, z: 0 },
      { x: 0, y: 0.16, z: 0 },
      { x: 2, y: 0.5, z: 0, pcb_port_id: "end" },
    ],
  }
  const input: HighDensityRoute = structuredClone(route)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0.5, layer: "top", pcb_port_id: "start" },
          { x: 2, y: 0.5, layer: "top", pcb_port_id: "end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.1,
        connectedTo: ["pcb_smtpad_obstacle", "pad_net"],
      },
    ],
  }
  const engine: AutoroutingDrcEngine = new AutoroutingDrcEngine(srj)
  const before: DrcSnapshot = getDrcSnapshot(
    srj,
    [route],
    undefined,
    undefined,
    engine,
  )
  expect(before.count).toBe(1)
  expect(before.errors[0]?.actual_clearance).toBeCloseTo(0.02, 8)
  expect(
    applyDrcErrorForces(
      srj,
      [route],
      before.errors,
      before.traceRouteIndexById,
      1,
    ),
  ).toBe(true)

  const after: DrcSnapshot = getDrcSnapshot(
    srj,
    [route],
    undefined,
    undefined,
    engine,
  )
  expect(after.issueScore).toBeLessThan(before.issueScore)
  expect(route.route[1]).not.toEqual(input.route[1])
  expect(route.route[2]).not.toEqual(input.route[2])
  expect(route.route[3]).toEqual(input.route[3])
  expect(route.route[0]).toEqual(input.route[0])
  expect(route.route.at(-1)).toEqual(input.route.at(-1))

  expect(
    applyDrcErrorForces(
      srj,
      [route],
      after.errors,
      after.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(getDrcSnapshot(srj, [route], undefined, undefined, engine).count).toBe(
    0,
  )
})
