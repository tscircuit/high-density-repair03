import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import {
  applyBroadRepulsionForces,
  cloneRoutes,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("via-trace repair honors the declared board clearance", (): void => {
  for (const clearance of [0.13, 0.2, 0.3, 0.8]) {
    const srj: SimpleRouteJson = {
      bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
      connections: [
        { name: "via_owner", pointsToConnect: [] },
        { name: "trace_owner", pointsToConnect: [] },
      ],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.45,
      minTraceToPadEdgeClearance: clearance,
    }
    // A real violation of the declared rule, but above the old 0.1 mm target.
    const viaY = 0.225 + 0.05 + clearance - 0.01
    const routes = cloneRoutes([
      {
        connectionName: "via_owner",
        route: [
          { x: -1, y: 1.5, z: 0 },
          { x: 0, y: viaY, z: 0 },
          { x: 0, y: viaY, z: 1 },
          { x: 1, y: 1.5, z: 1 },
        ],
        vias: [{ x: 0, y: viaY }],
        traceThickness: 0.1,
        viaDiameter: 0.45,
      },
      {
        connectionName: "trace_owner",
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
        traceThickness: 0.1,
        viaDiameter: 0.45,
      },
    ])
    const before = getDrcSnapshot(srj, routes)
    expect(before.count).toBeGreaterThan(0)
    const endpoints = routes.map((route) => [
      { ...route.route[0]! },
      { ...route.route.at(-1)! },
    ])
    const output = applyBroadRepulsionForces(srj, routes, 1, 1)
    const via = output[0]!.vias[0]!
    const trace = output[1]!
    const gap = Math.min(
      ...trace.route
        .slice(1)
        .map(
          (point, index): number =>
            pointToSegmentDistance(via, trace.route[index]!, point) -
            output[0]!.viaDiameter / 2 -
            trace.traceThickness / 2,
        ),
    )
    expect(gap).toBeGreaterThanOrEqual(clearance)
    expect(getDrcSnapshot(srj, output).count).toBe(0)
    for (const [index, route] of output.entries()) {
      expect([route.route[0], route.route.at(-1)]).toEqual(endpoints[index]!)
      expect(route.traceThickness).toBe(0.1)
      expect(route.viaDiameter).toBe(0.45)
    }
  }
})
