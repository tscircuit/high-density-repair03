import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("moves only the via reported by a via-to-pad clearance error", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "other_via_net", pointsToConnect: [] },
      { name: "pad_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "pad_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "via_net",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "other_via_net",
      route: [
        { x: 1, y: 1, z: 0 },
        { x: 1.5, y: 1, z: 0 },
        { x: 1.5, y: 1, z: 1 },
        { x: 2, y: 1, z: 1 },
      ],
      vias: [{ x: 1.5, y: 1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
        pcb_via_ids: ["via_0"],
        message:
          'pcb_via "via_0" and pcb_smtpad "pcb_smtpad_foreign" are too close',
        center: { x: 0.2, y: 0 },
      },
    ],
    new Map(),
    1,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]?.x).toBeLessThan(0)
  expect(routes[1]?.route[1]).toMatchObject({ x: 1.5, y: 1 })
})
