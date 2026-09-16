import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("both merge directions preserve either or both protected via terminals", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
  }
  const connMap = new ConnectivityMap({ net: ["left", "right"] })
  const terminalIds = ["left_terminal", "right_terminal"]
  for (const protectedRoutes of [[], [0], [1], [0, 1]]) {
    const input: HighDensityRoute[] = ["left", "right"].map(
      (connectionName, index) => {
        const x = index * 0.05
        return {
          connectionName,
          traceThickness: 0.1,
          viaDiameter: 0.3,
          vias: [{ x, y: 0 }],
          route: [
            { x: -1, y: index, z: 0 },
            { x, y: 0, z: 0 },
            { x, y: 0, z: 1 },
            { x: 1, y: index, z: 1 },
          ],
        }
      },
    )
    for (const index of protectedRoutes) {
      const route = input[index]!.route
      route.shift()
      route[0]!.pcb_port_id = terminalIds[index]!
    }
    for (const scale of [1, 1.75, -1]) {
      const routes = cloneRoutes(input)
      const changed = applyDrcErrorForces(
        srj,
        routes,
        [
          {
            type: "pcb_via_clearance_error",
            pcb_via_ids: ["via_0", "via_1"],
            pcb_via_pair_net_relation: "same_net",
            center: { x: 0.025, y: 0 },
          },
        ],
        new Map(),
        scale,
        connMap,
        true,
        true,
      )
      expect(changed).toBe(protectedRoutes.length < 2)
      for (const [index, route] of routes.entries()) {
        expect(route.route[0]).toEqual(input[index]!.route[0])
        expect(route.route.at(-1)).toEqual(input[index]!.route.at(-1))
      }
      if (protectedRoutes.length === 2) {
        expect(routes).toEqual(cloneRoutes(input))
        continue
      }
      let destinationX = 0
      if (
        protectedRoutes.includes(1) ||
        (protectedRoutes.length === 0 && scale < 0)
      )
        destinationX = 0.05
      for (const route of routes) {
        const viaPoint = route.route.find((point) => point.z === 1)!
        expect(viaPoint.x).toBe(destinationX)
        expect(viaPoint.y).toBe(0)
      }
    }
  }
})
