import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPeerTraceRepairCandidates } from "../lib/solvers/GlobalDrcForceImproveSolver/getPeerTraceRepairCandidates"

test("peer layer bridges do not place unvalidated vias at PCB terminals", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "a0" },
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0, pcb_port_id: "a1" },
      ],
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 2, y: -1, z: 0, pcb_port_id: "b0" },
        { x: 2, y: 1, z: 0, pcb_port_id: "b1" },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 6, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [],
  }
  let bridgeCount = 0
  for (const candidate of getPeerTraceRepairCandidates({
    srj,
    routes,
    pair: ["a", "b"],
  })) {
    for (const [index, route] of candidate.entries()) {
      const original = routes[index]!
      const terminals = [original.route[0]!, original.route.at(-1)!]
      for (const via of route.vias) {
        bridgeCount++
        for (const terminal of terminals) {
          expect(
            Math.hypot(via.x - terminal.x, via.y - terminal.y),
          ).toBeGreaterThan(1e-9)
        }
      }
      expect(route.route[0]).toEqual(original.route[0])
      expect(route.route.at(-1)).toEqual(original.route.at(-1))
    }
  }
  expect(bridgeCount).toBeGreaterThan(0)
})
