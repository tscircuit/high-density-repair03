import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("via-pad force selects the nearby pad among expanded net aliases", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["distant-pad", "near-pad", "foreign-net"],
      },
      {
        type: "rect",
        center: { x: 0.4, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["near-pad", "distant-pad", "foreign-net"],
      },
    ],
    connections: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "via-owner",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: -0.5, z: 1 },
      ],
    },
  ]
  const routes = cloneRoutes(input)
  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_pad_pad_clearance_error",
        message: "pcb_via via_0 is too close to pcb_smtpad near-pad",
        pcb_trace_id: "via-owner_0",
        pcb_via_ids: ["via_0"],
        pcb_pad_ids: ["via_0", "near-pad"],
        center: { x: 0.1, y: 0 },
      },
    ],
    new Map([["via-owner_0", 0]]),
    1,
  )

  expect(changed).toBe(true)
  const via = routes[0]!.route[1]!
  expect(0.2 - via.x - 0.15).toBeGreaterThanOrEqual(0.1)
  expect(routes[0]!.route[2]!.x).toBe(via.x)
  expect(routes[0]!.route[2]!.y).toBe(via.y)
  expect(routes[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
})
