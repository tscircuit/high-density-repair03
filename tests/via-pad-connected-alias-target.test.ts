import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("via repair targets the nearby pad rather than another pad on its net", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -8, minY: -3, maxX: 3, maxY: 3 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    connections: [{ name: "signal", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_far", "pad_net", "pcb_smtpad_near"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_near", "pad_net", "pcb_smtpad_far"],
      },
    ],
  }
  const routes = cloneRoutes([
    {
      connectionName: "signal",
      route: [
        { x: -1, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 2 },
        { x: -1, y: 1, z: 2 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])
  const engine = new AutoroutingDrcEngine(srj)
  const before = getDrcSnapshot(srj, routes, undefined, undefined, engine)
  expect(before.errors).toHaveLength(1)
  expect(before.errors[0]!.pcb_pad_ids).toContain("pcb_smtpad_near")

  expect(
    applyDrcErrorForces(
      srj,
      routes,
      before.errors,
      before.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(routes[0]!.route[1]!.x).toBeLessThan(0)
  expect(routes[0]!.route[2]).toMatchObject({
    x: routes[0]!.route[1]!.x,
    y: routes[0]!.route[1]!.y,
  })
  expect(
    getDrcSnapshot(srj, routes, undefined, undefined, engine).errors,
  ).toHaveLength(0)
})
