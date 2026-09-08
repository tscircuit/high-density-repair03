import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyBroadRepulsionForces,
  applyDrcErrorForces,
  cloneRoutes,
  getForceMoveGuard,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("repair forces preserve immutable trace and via copper", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: -0.4, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pad"],
      },
    ],
    connections: [],
    layerCount: 4,
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
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 3 },
        { x: 1, y: 1, z: 3 },
      ],
    },
  ]
  const fixedRoutes: HighDensityRoute[] = [
    {
      connectionName: "fixed-trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0.32, y: -0.2, z: 1 },
        { x: 0.32, y: 0.2, z: 1 },
      ],
    },
  ]
  const fixedBefore = structuredClone(fixedRoutes)
  const routes = cloneRoutes(input)
  getForceMoveGuard(routes, undefined, srj, fixedRoutes)
  applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_pad_pad_clearance_error",
        message: "pcb_via via_0 is too close to pcb_smtpad pad",
        pcb_trace_id: "via-owner_0",
        pcb_via_ids: ["via_0"],
        pcb_pad_ids: ["via_0", "pad"],
        center: { x: -0.1, y: 0 },
      },
    ],
    new Map([["via-owner_0", 0]]),
    1,
  )
  const via = routes[0]!.route[1]!
  expect(via.x).toBeGreaterThan(0)
  expect(0.32 - via.x - 0.15 - 0.05).toBeGreaterThanOrEqual(0.099996)
  expect(routes[0]!.route[2]).toEqual({ ...via, z: 3 })

  const broad = applyBroadRepulsionForces(
    srj,
    input,
    1,
    1,
    undefined,
    false,
    true,
    fixedRoutes,
  )
  expect(broad).toHaveLength(1)
  expect(broad[0]!.route[1]!.x).toBeGreaterThan(0)
  expect(0.32 - broad[0]!.route[1]!.x - 0.2).toBeGreaterThanOrEqual(0.099996)
  expect(fixedRoutes).toEqual(fixedBefore)
  expect(input[0]!.route[1]!.x).toBe(0)

  const fixedVia: HighDensityRoute = {
    ...fixedRoutes[0]!,
    connectionName: "fixed-via",
    route: [
      { x: 0.42, y: 0, z: 1 },
      { x: 0.42, y: 0, z: 2 },
    ],
    vias: [{ x: 0.42, y: 0 }],
  }
  const viaGuard = getForceMoveGuard(routes, undefined, srj, [fixedVia])
  const movement = viaGuard.constrain(
    [routes[0]!.route[1]!, routes[0]!.route[2]!],
    0.3,
    0,
  )
  expect(via.x + movement.x).toBeLessThanOrEqual(0.020002)
})
